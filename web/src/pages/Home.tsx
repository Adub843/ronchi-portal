import { api, can, type Me } from "../api";
import type { Unread } from "../components/Alerts";
import { Link, PageHead, useLoad } from "../components/ui";
import { t } from "../i18n";
import { QuickLinks } from "../components/QuickLinks";
import { useRoleNames } from "../roles";

export function Home({ me, unread }: { me: Me; unread: Unread }) {
  const boards = useLoad(() => (can(me, "boards.use") ? api("/boards") : Promise.resolve({ boards: [] })));
  const orders = useLoad(() => (can(me, "orders.view") ? api("/change-parts") : Promise.resolve(null)));
  const sales = useLoad(() => (can(me, "cpsales.view") ? api("/change-parts/sales") : Promise.resolve(null)));
  const hour = new Date().getHours();
  useRoleNames();
  const greet = hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");

  return (
    <>
      <PageHead title={`${greet}, ${me.name.split(" ")[0]}`} sub={t("Ronchi America control hub")} tip="home.head" />
      <QuickLinks me={me} />
      <div className="tiles">
        {can(me, "boards.use") && (
          <Link to="/chats" className="panel tile">
            <h2>{t("Chats")}</h2>
            <span className="stat"><span className="n">{unread.chats}</span><span className="l">{t("Unread")}</span></span>
            <span className="muted">{t("Private messages with anyone on staff, with photos and files.")}</span>
          </Link>
        )}
        {can(me, "boards.use") && (
          <Link to="/boards" className="panel tile">
            <h2>{t("Message boards")}</h2>
            <span className="stat"><span className="n">{boards.data?.boards.length ?? "–"}</span><span className="l">{t("Boards")}</span></span>
            <span className="muted">
              {boards.data?.boards[0] ? t("Latest: {name}", { name: boards.data.boards[0].name }) : t("Start a board for a team, machine or order")}
            </span>
          </Link>
        )}
        {can(me, "jobs.view") && (
          <Link to="/jobs" className="panel tile">
            <h2>{t("Jobs")}</h2>
            <span className="muted">{t("Field service visits: who is going where, and when. Each job opens its work order.")}</span>
          </Link>
        )}
        {can(me, "kb.view") && (
          <Link to="/kb" className="panel tile">
            <h2>{t("Knowledge base")}</h2>
            <span className="muted">{t("One Point Lessons, how-tos, known issues and quick notes. Search by the problem or the machine.")}</span>
          </Link>
        )}
        {can(me, "machines.view") && (
          <Link to="/machines" className="panel tile">
            <h2>{t("Machines")}</h2>
            <span className="muted">{t("Find any machine by number, model or customer.")}</span>
          </Link>
        )}
        {(can(me, "orders.view") || can(me, "cpsales.view")) && (
          <Link to={can(me, "orders.view") ? "/change-parts" : "/change-parts/sales"} className="panel tile">
            <h2>{t("Change parts")}</h2>
            {can(me, "cpsales.view") && <span className="stat"><span className="n">{sales.data ? sales.data.sales.filter((o: any) => o.open).length : "–"}</span><span className="l">{t("Open sales")}</span></span>}
            {can(me, "orders.view") && <span className="stat"><span className="n">{orders.data ? orders.data.orders.filter((o: any) => o.open && o.status !== "Folder only").length : "–"}</span><span className="l">{t("Open orders")}</span></span>}
            <span className="muted">{t("Every change-part job, from the first request to shipped.")}</span>
          </Link>
        )}
        <Link to="/learn" className="panel tile">
          <h2>{t("Portal training")}</h2>
          <span className="muted">{t("Step-by-step guides for everything your access allows, by job and by page.")}</span>
        </Link>
      </div>
    </>
  );
}
