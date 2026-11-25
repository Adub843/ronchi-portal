"""Ronchi Portal export: an add-in for the Fusion that is already open and signed in.

It watches a folder. Put one folder per assembly in INBOX, holding the top assembly and every part
and sub-assembly file it uses (SolidWorks .sldasm/.sldprt, or Inventor, Creo, NX, Parasolid ...).
The add-in uploads the set to the Fusion project "Ronchi Portal CAD" (Fusion translates it in the
Autodesk cloud), opens it, saves it as STEP in OUTBOX with every part and assembly keeping its
name, and closes it. The STEP file then goes into the portal: Parts catalog > machine >
"Add 3D for the whole machine", which puts each assembly on its own parts list.

    C:\\ronchi-cad\\inbox\\4011MB\\4011MB.sldasm + parts   ->   C:\\ronchi-cad\\outbox\\4011MB.step

Which file is the top assembly: a file named like the folder, else the biggest .sldasm/.iam/.asm.
Progress and errors go to C:\\ronchi-cad\\log.txt; a finished folder moves to done\\ (or
failed\\). It handles one assembly at a time, between your own clicks, so Fusion stays usable.
"""
import adsk.core
import adsk.fusion
import os
import shutil
import threading
import time
import traceback

# Outside OneDrive on purpose, so company CAD doesn't sync to a personal cloud.
ROOT = os.path.join(os.environ.get("SystemDrive", "C:") + os.sep, "ronchi-cad")
INBOX, OUTBOX, DONE, FAILED = (os.path.join(ROOT, d) for d in ("inbox", "outbox", "done", "failed"))
LOG = os.path.join(ROOT, "log.txt")
PROJECT = "Ronchi Portal CAD"
EVENT_ID = "RonchiPortalExportTick"
ASSEMBLY_EXT = (".sldasm", ".iam", ".asm", ".prt", ".x_t", ".x_b", ".f3d", ".catproduct")
CAD_EXT = ASSEMBLY_EXT + (".sldprt", ".ipt", ".par", ".psm", ".catpart", ".step", ".stp", ".iges", ".igs", ".sat", ".3dm")
UPLOAD_TIMEOUT = 60 * 60  # an hour for a very big machine

app = adsk.core.Application.get()
handlers = []
_stop = threading.Event()
busy = threading.Lock()


def log(msg):
    os.makedirs(ROOT, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")


def project():
    for p in app.data.dataProjects:
        if p.name == PROJECT:
            return p
    return app.data.dataProjects.add(PROJECT)


def top_file(folder, files):
    name = os.path.basename(folder).lower()
    tops = [f for f in files if f.lower().endswith(ASSEMBLY_EXT)]
    for f in tops:
        if os.path.splitext(os.path.basename(f))[0].lower() == name:
            return f
    if tops:
        return max(tops, key=os.path.getsize)
    return max(files, key=os.path.getsize) if files else None


def wait_upload(future):
    start = time.time()
    while future.uploadState == adsk.core.UploadStates.UploadProcessing:
        if time.time() - start > UPLOAD_TIMEOUT:
            raise RuntimeError("Fusion took over an hour to translate it")
        adsk.doEvents()
        time.sleep(0.5)
    if future.uploadState != adsk.core.UploadStates.UploadFinished:
        raise RuntimeError("Fusion could not translate the files (upload failed)")
    data_file = future.dataFile
    # The translation finishes a little after the upload; wait until the file can be opened.
    while not data_file.isComplete if hasattr(data_file, "isComplete") else False:
        adsk.doEvents()
        time.sleep(0.5)
    return data_file


def export_one(folder):
    name = os.path.basename(folder)
    files = [os.path.join(dp, f) for dp, _, fs in os.walk(folder) for f in fs if f.lower().endswith(CAD_EXT)]
    top = top_file(folder, files)
    if not top:
        raise RuntimeError("no CAD files in the folder")
    others = [f for f in files if f != top]
    log(f"{name}: uploading {os.path.basename(top)} with {len(others)} other files")
    root_folder = project().rootFolder
    if others:
        future = root_folder.uploadAssembly([top] + others)
    else:
        future = root_folder.uploadFile(top)
    data_file = wait_upload(future)
    log(f"{name}: translated, opening")
    doc = app.documents.open(data_file, False)
    try:
        design = adsk.fusion.Design.cast(doc.products.itemByProductType("DesignProductType"))
        rc = design.rootComponent
        if rc.allOccurrences.count == 0 and rc.bRepBodies.count == 0:
            # Seen with SolidWorks assemblies whose references Fusion can't resolve: every file
            # arrives on its own and the assembly opens empty. Don't save an empty STEP.
            raise RuntimeError("Fusion opened the assembly empty: it could not link its parts")
        os.makedirs(OUTBOX, exist_ok=True)
        out = os.path.join(OUTBOX, name + ".step")
        em = design.exportManager
        if not em.execute(em.createSTEPExportOptions(out, design.rootComponent)):
            raise RuntimeError("Fusion could not save the STEP file")
        log(f"{name}: saved {out} ({os.path.getsize(out) // 1024} KB)")
    finally:
        doc.close(False)


def tick():
    if not busy.acquire(blocking=False):
        return
    try:
        if not os.path.isdir(INBOX):
            return
        jobs = sorted(d for d in os.listdir(INBOX) if os.path.isdir(os.path.join(INBOX, d)))
        if not jobs:
            return
        folder = os.path.join(INBOX, jobs[0])
        # Skip a folder that is still being copied in.
        newest = max((os.path.getmtime(os.path.join(dp, f)) for dp, _, fs in os.walk(folder) for f in fs), default=0)
        if time.time() - newest < 30:
            return
        try:
            export_one(folder)
            dest = DONE
        except Exception as e:  # noqa: BLE001 - one bad assembly must not stop the rest
            log(f"{jobs[0]}: FAILED: {e}\n{traceback.format_exc()}")
            dest = FAILED
        os.makedirs(dest, exist_ok=True)
        target = os.path.join(dest, jobs[0] + time.strftime("-%Y%m%d-%H%M%S"))
        shutil.move(folder, target)
    finally:
        busy.release()


class TickHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            tick()
        except Exception:  # noqa: BLE001
            log("tick error: " + traceback.format_exc())


def timer():
    while not _stop.wait(15):
        app.fireCustomEvent(EVENT_ID, "")


def run(context):
    try:
        for d in (INBOX, OUTBOX):
            os.makedirs(d, exist_ok=True)
        event = app.registerCustomEvent(EVENT_ID)
        h = TickHandler()
        event.add(h)
        handlers.append(h)
        threading.Thread(target=timer, daemon=True).start()
        log(f"started, watching {INBOX}")
    except Exception:  # noqa: BLE001
        log("start error: " + traceback.format_exc())


def stop(context):
    _stop.set()
    try:
        app.unregisterCustomEvent(EVENT_ID)
    except Exception:  # noqa: BLE001
        pass
    log("stopped")

