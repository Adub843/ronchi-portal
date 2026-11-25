# Catalog renders: a LabBridge recipe that turns one CAD assembly (STEP) into the pictures the
# parts catalog shows. Run it with scripts/fusion-renders.mjs on the PC where Fusion and the
# LabBridge add-in run; never paste it into LabBridge itself.
#
# make(design, root, P) imports P["_input"] (the STEP file LabBridge was handed) and saves, in
# P["_folder"]/renders/:
#   view-iso.png, view-front.png, view-top.png, view-right.png   the whole assembly
#   part-<name>.png    each part and sub-assembly on its own, once per component (a screw used
#                      20 times is drawn once)
#   manifest.json      {"version": 1, "source", "units": "mm", "views": {"iso": "view-iso.png", ...},
#                       "parts": [{"name", "code", "file", "size": [x, y, z], "count"}], "notes": [...]}
# "name" is the CAD component name (Ronchi codes lead it: "GF009097 piastra", "CA086399_A").
# The portal reads the part code from the name itself; "code" here is only a hint for people.
#
# make_demo(design, root, P) builds a small test assembly instead (a plate, a shaft group with a
# shaft and a bush, four screws), so the recipe can be tried without real CAD. The runner exports
# it as STEP and renders that, so the test goes through the same STEP import as real files.
#
# Fusion works in centimetres; sizes in the manifest are millimetres.
import os, re, json, time

CODE_IN_NAME = re.compile(r"^((?:RA\d{0,4}[A-Z]{0,3}_)?(?:[A-Z]{2,3}\d{6}(?:_\d{1,3})?|\d{10}))(?=$|[^0-9])", re.I)
VIEWS = [
    ("iso", "IsoTopRightViewOrientation"),
    ("front", "FrontViewOrientation"),
    ("top", "TopViewOrientation"),
    ("right", "RightViewOrientation"),
]
# Display switches that put a grid, a ground plane or shadows into a picture. Each one that is on
# is switched off for the renders and switched back on afterwards.
DISPLAY_OFF = re.compile(r"LayoutGrid|GroundPlane|GroundShadow|Reflection", re.I)


def _mm(v):
    return v / 10.0


def _safe(name):
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return (s or "part")[:80]


def _code(name):
    m = CODE_IN_NAME.match(name.strip())
    return m.group(1).upper() if m else None


def _size(box):
    if box is None:
        return None
    return [round((getattr(box.maxPoint, k) - getattr(box.minPoint, k)) * 10, 1) for k in ("x", "y", "z")]


def _display_off(notes):
    """Switch off grid, ground plane and shadows where Fusion lets an add-in do it. Returns undo steps."""
    undo = []
    try:
        ui = app.userInterface
        seen = []
        for i in range(ui.commandDefinitions.count):
            cd = ui.commandDefinitions.item(i)
            if not DISPLAY_OFF.search(cd.id or ""):
                continue
            seen.append(cd.id)
            box = adsk.core.CheckBoxControlDefinition.cast(cd.controlDefinition)
            if box and box.isChecked:
                try:
                    box.isChecked = False
                    undo.append((cd.id, box))
                except Exception as e:
                    notes.append("could not switch off %s: %s" % (cd.id, e))
        notes.append("display switches found: %s; switched off: %s" % (", ".join(seen) or "none", ", ".join(i for i, _ in undo) or "none"))
    except Exception as e:
        notes.append("display switches not reachable: %s" % e)
    return undo


def _shoot(vp, orientation, path, size, notes):
    cam = vp.camera
    cam.isSmoothTransition = False
    try:
        cam.cameraType = adsk.core.CameraTypes.OrthographicCameraType
    except Exception:
        pass
    cam.viewOrientation = getattr(adsk.core.ViewOrientations, orientation)
    cam.isFitView = True
    vp.camera = cam
    adsk.doEvents()
    vp.fit()
    adsk.doEvents()
    try:
        o = adsk.core.SaveImageFileOptions.create(path)
        o.width = size
        o.height = size
        o.isBackgroundTransparent = True
        o.isAntiAliased = True
        ok = vp.saveAsImageFileWithOptions(o)
    except Exception as e:
        if "transparent" not in " ".join(notes):
            notes.append("transparent background not available (%s); the runner still whitens the background" % e)
        ok = vp.saveAsImageFile(path, size, size)
    return bool(ok) and os.path.isfile(path)


class _Shown:
    """Which occurrences have their light bulb on. Only changes are sent to Fusion."""

    def __init__(self, root):
        self.occs = [o for o in root.allOccurrences]
        self.state = {o.fullPathName: o.isLightBulbOn for o in self.occs}
        self.start = dict(self.state)
        self.bodies = [b for b in root.bRepBodies]

    def _set(self, want):
        # Off first, then on: a component used twice shares some visibility, and "on" must win
        # for the branch being drawn.
        for flag in (False, True):
            for o in self.occs:
                p = o.fullPathName
                if want[p] == flag and self.state[p] != flag:
                    o.isLightBulbOn = flag
                    self.state[p] = flag

    def only(self, target):
        t = target.fullPathName
        self._set({o.fullPathName: (o.fullPathName == t or t.startswith(o.fullPathName + "+") or o.fullPathName.startswith(t + "+")) for o in self.occs})
        for b in self.bodies:
            b.isLightBulbOn = False

    def all(self):
        self._set({o.fullPathName: True for o in self.occs})
        for b in self.bodies:
            b.isLightBulbOn = True

    def restore(self):
        self._set(self.start)


def make(design, root, P):
    started = time.time()
    folder = P["_folder"]
    src = P.get("_input")
    if not src or not os.path.isfile(src):
        raise RuntimeError("No input.step in the job folder.")
    out = os.path.join(folder, "renders")
    os.makedirs(out, exist_ok=True)
    size = int(P.get("size") or 1024)
    limit = int(P.get("max_parts") or 3000)
    notes = []

    im = app.importManager
    im.importToTarget(im.createSTEPImportOptions(src), root)
    adsk.doEvents()

    vp = app.activeViewport
    try:
        vp.visualStyle = adsk.core.VisualStyles.ShadedWithVisibleEdgesOnlyVisualStyle
    except Exception as e:
        notes.append("visual style not set: %s" % e)
    undo = _display_off(notes)
    shown = _Shown(root)
    manifest = {"version": 1, "source": os.path.basename(P.get("source") or src), "units": "mm", "size": size,
                "views": {}, "parts": [], "notes": notes}
    try:
        # One picture per component, from its first occurrence. Names that clash on disk get a number.
        by_comp = {}
        order = []
        # A STEP import puts everything in one wrapper occurrence named after the file; it is the
        # whole assembly again (the views), so it gets no picture of its own.
        tops = [o for o in root.occurrences]
        wrapper = tops[0].fullPathName if len(tops) == 1 and not _code(tops[0].component.name) else None
        for o in shown.occs:
            if o.fullPathName == wrapper:
                continue
            c = o.component
            key = getattr(c, "id", None) or c.name
            if key in by_comp:
                by_comp[key]["count"] += 1
                continue
            by_comp[key] = {"occ": o, "name": c.name, "count": 1}
            order.append(key)
        used = set()
        for key in order[:limit]:
            item = by_comp[key]
            o = item["occ"]
            base = "part-" + _safe(item["name"])
            f, n = base + ".png", 2
            while f.lower() in used:
                f, n = "%s-%d.png" % (base, n), n + 1
            used.add(f.lower())
            shown.only(o)
            ok = _shoot(vp, "IsoTopRightViewOrientation", os.path.join(out, f), size, notes)
            manifest["parts"].append({
                "name": item["name"], "code": _code(item["name"]), "file": f if ok else None,
                "size": _size(o.boundingBox), "count": item["count"],
            })
        if len(order) > limit:
            notes.append("only the first %d of %d components were drawn (max_parts)" % (limit, len(order)))

        # The whole assembly last: right after the import Fusion's first fit is off centre.
        shown.all()
        _shoot(vp, "IsoTopRightViewOrientation", os.path.join(out, "_warmup.png"), 64, notes)
        for name, orient in VIEWS:
            f = "view-%s.png" % name
            if _shoot(vp, orient, os.path.join(out, f), size, notes):
                manifest["views"][name] = f
        try:
            os.remove(os.path.join(out, "_warmup.png"))
        except OSError:
            pass
    finally:
        try:
            shown.restore()
        except Exception:
            pass
        for _, box in undo:
            try:
                box.isChecked = True
            except Exception:
                pass
    manifest["seconds"] = round(time.time() - started, 1)
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)


def make_demo(design, root, P):
    """A small test assembly with Ronchi-style names. LabBridge exports it as model.step."""
    tbm = adsk.fusion.TemporaryBRepManager.get()
    diff = adsk.fusion.BooleanTypes.DifferenceBooleanType

    def at(x, y, z):
        m = adsk.core.Matrix3D.create()
        m.translation = adsk.core.Vector3D.create(_mm(x), _mm(y), _mm(z))
        return m

    def comp(parent, name, x=0, y=0, z=0):
        occ = parent.occurrences.addNewComponent(at(x, y, z))
        occ.component.name = name
        return occ.component

    def box(cx, cy, cz, w, d, h):
        return tbm.createBox(adsk.core.OrientedBoundingBox3D.create(
            adsk.core.Point3D.create(_mm(cx), _mm(cy), _mm(cz)),
            adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0), _mm(w), _mm(d), _mm(h)))

    def cyl(x, y, z0, z1, r):
        return tbm.createCylinderOrCone(adsk.core.Point3D.create(_mm(x), _mm(y), _mm(z0)), _mm(r),
                                        adsk.core.Point3D.create(_mm(x), _mm(y), _mm(z1)), _mm(r))

    plate = comp(root, "GF000001 test plate")
    b = box(0, 0, 5, 120, 80, 10)
    tbm.booleanOperation(b, cyl(0, 0, -1, 11, 10.5), diff)
    for x, y in ((-50, -30), (50, -30), (-50, 30), (50, 30)):
        tbm.booleanOperation(b, cyl(x, y, -1, 11, 3.2), diff)
    plate.bRepBodies.add(b)

    grp = comp(root, "GS000004 shaft group", 0, 0, 10)
    shaft = comp(grp, "CA000002_A shaft")
    shaft.bRepBodies.add(cyl(0, 0, -10, 60, 10))
    bush = comp(grp, "CM000003 bush")
    t = cyl(0, 0, 0, 20, 16)
    tbm.booleanOperation(t, cyl(0, 0, -1, 21, 10.2), diff)
    bush.bRepBodies.add(t)

    screw = None
    for x, y in ((-50, -30), (50, -30), (-50, 30), (50, 30)):
        if screw is None:
            screw = comp(root, "0000012345 screw M6", x, y, 0)
            s = cyl(0, 0, -4, 10, 3)
            tbm.booleanOperation(s, cyl(0, 0, 10, 14, 5), adsk.fusion.BooleanTypes.UnionBooleanType)
            screw.bRepBodies.add(s)
        else:
            occ = root.occurrences.addExistingComponent(screw, adsk.core.Matrix3D.create())
            occ.transform2 = at(x, y, 0)
