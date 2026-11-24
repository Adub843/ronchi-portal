import { api, can, fmtTime, type Me } from "../api";
import { Link, PageHead, useLoad } from "../components/ui";

export function Home({ me }: { me: Me }) {
  const clock = useLoad(() => (can(me, "clock.use") ? api("/clock/status") : Promise.resolve(null)));
  const boards = useLoad(() => (can(me, "boards.use") ? api("/boards") : Promise.resolve({ boards: [] })));
  const edits = useLoad(() => (can(me, "hours.approve") ? api("/clock/edits") : Promise.resolve({ edits: [] })));
  const last = clock.data?.last;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHead title={`${greet}, ${me.name.split(" ")[0]}`} sub="Ronchi America control hub" />
      <div className="tiles">
        {can(me, "clock.use") && (
          <Link to="/clock" className="panel tile">
            <h2>Time clock</h2>
            <span className={`pill ${last?.kind === "in" ? "p-ok" : "p-info"}`}>{last?.kind === "in" ? "Clocked in" : "Clocked out"}</span>
            <span className="muted">{last ? `Since ${fmtTime(last.at)}` : "No punches yet"}</span>
          </Link>
        )}
        {can(me, "boards.use") && (
          <Link to="/boards" className="panel tile">
            <h2>Message boards</h2>
            <span className="stat"><span className="n">{boards.data?.boards.length ?? "–"}</span><span className="l">Boards</span></span>
            <span className="muted">
              {boards.data?.boards[0] ? `Latest: ${boards.data.boards[0].name}` : "Start a board for a team, machine or order"}
            </span>
          </Link>
        )}
        {can(me, "hours.approve") && (
          <Link to="/hours" className="panel tile">
            <h2>Hours</h2>
            <span className="stat"><span className="n">{edits.data?.edits.length ?? "–"}</span><span className="l">Time changes to approve</span></span>
          </Link>
        )}
        {can(me, "machines.view") && (
          <Link to="/machines" className="panel tile">
            <h2>Machines</h2>
            <span className="muted">Find any machine by number, model or customer.</span>
          </Link>
        )}
        <div className="panel tile">
          <h2>Coming next</h2>
          <span className="muted">Knowledge base, training center, workbook Submit, orders, schedule and remote support arrive in the next steps.</span>
        </div>
      </div>
    </>
  );
}
