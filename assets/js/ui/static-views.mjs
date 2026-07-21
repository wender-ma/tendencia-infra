import adminMarkup from '../../views/tabs/admin.html?raw';
import detailsMarkup from '../../views/tabs/details.html?raw';
import flowsMarkup from '../../views/tabs/flows.html?raw';
import historyMarkup from '../../views/tabs/history.html?raw';
import manualMarkup from '../../views/tabs/manual.html?raw';
import overviewMarkup from '../../views/tabs/overview.html?raw';
import projectionControlMarkup from '../../views/tabs/projection-control.html?raw';
import projectionMarkup from '../../views/tabs/projection.html?raw';
import uploadsMarkup from '../../views/tabs/uploads.html?raw';
import dialogsMarkup from '../../views/dialogs.html?raw';
import { parseLocalMarkup } from './dom.mjs';

const STATIC_VIEWS = Object.freeze([
  ['tab-visao', overviewMarkup],
  ['tab-detalhe', detailsMarkup],
  ['tab-flows', flowsMarkup],
  ['tab-historico', historyMarkup],
  ['tab-projecao', projectionMarkup],
  ['tab-projecao_ctrl', projectionControlMarkup],
  ['tab-uploads', uploadsMarkup],
  ['tab-admin', adminMarkup],
  ['tab-manual', manualMarkup],
  ['dialogMount', dialogsMarkup],
]);

export function mountStaticViews(root = document) {
  for (const [targetId, markup] of STATIC_VIEWS) {
    const target = root.getElementById(targetId);
    if (!target) throw new Error(`Container estático ausente: #${targetId}`);
    target.replaceChildren(...parseLocalMarkup(markup));
  }
}
