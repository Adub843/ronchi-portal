import { api, can, type Me } from "../api";
import type { Unread } from "../components/Alerts";
import { Link, PageHead, useLoad } from "../components/ui";
import { t } from "../i18n";
import { QuickLinks } from "../components/QuickLinks";
import { useRoleNames } from "../roles";

export function Home({ me, unread }: { me: Me; unread: Unread }) {
  const boards = useLoad(() => (can(me, "boards.use") ? api("/boards") : Promise.resolve({ boards: [] })));
  const orders = useLoad(() => (can(me, "orders.view") ? api("/change-parts") : Promise.resolve(null)));
  const hour = new Date().getHours();
  useRoleNames();
  const greet = hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");

  return (
    <>
      <PageHead title={`${greet}, ${me.name.split(" ")[0]}`} sub={t("Ronchi America control hub")} />
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
        {can(me, "orders.view") && (
          <Link to="/change-parts" className="panel tile">
            <h2>{t("Change-part orders")}</h2>
            <span className="stat"><span className="n">{orders.data ? orders.data.orders.filter((o: any) => o.open && o.status !== "Folder only").length : "–"}</span><span className="l">{t("Open jobs")}</span></span>
            <span className="muted">{t("Every change-part job, from quote to shipped.")}</span>
          </Link>
        )}
        <div className="panel tile">
          <h2>{t("Coming next")}</h2>
          <span className="muted">{t("Workbook Submit, service report filing, schedule and remote support arrive in the next steps.")}</span>
        </div>
      </div>
    </>
  );
}
