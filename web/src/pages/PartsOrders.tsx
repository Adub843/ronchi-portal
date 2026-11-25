// Parts orders (/parts-orders). Placeholder page: the full screens are built in their own change.
import type { Me } from "../api";
import { PageHead } from "../components/ui";
import { t } from "../i18n";

export function PartsOrders({ me: _me, path: _path }: { me: Me; path: string }) {
  return <PageHead title={t("Parts orders")} />;
}
