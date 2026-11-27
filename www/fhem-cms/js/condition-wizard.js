import { validateCondition, evaluateCondition, MAX_CONDITION_DEPTH, MAX_CONDITION_NODES } from './condition.js';
import { lookupValue } from './freehtml.js';
import { groupSnapshots } from './condition-snapshots.js';
import { openPlaceholderPicker } from './placeholder-picker.js';
import { showCmsModal } from './modal-dialog.js';

const OPERATORS = [
  ['==', 'gleich'], ['!=', 'ungleich'], ['<', 'kleiner'], ['<=', 'kleiner oder gleich'],
  ['>', 'größer'], ['>=', 'größer oder gleich'], ['contains', 'enthält'], ['regex', 'regulärer Ausdruck'],
];

export function openConditionWizard({services, initial = null, allowElse = false, allowMode = false, signal = null}) {
  if (typeof services?.listAllDevices !== 'function') throw new Error('Geräteliste ist nicht verfügbar');
  if (initial?.condition) validateCondition(initial.condition);
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(null); return; }
    const pickerAbort = new AbortController();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Bedingung bearbeiten');
    dialog.innerHTML = `<style>
      dialog { color:var(--cms-text,#edf4ef); background:var(--cms-surface,#202e27);
        border:1px solid var(--cms-border,#43564a); border-radius:1rem;
        width:min(94vw,48rem); max-height:94vh; overflow:auto; padding:1rem; }
      dialog::backdrop { background:var(--cms-backdrop,rgb(0 0 0 / .6)); }
      form { display:grid; gap:.75rem; } .rule { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; }
      button, select, input { font:inherit; color:inherit; background:var(--cms-bg,#17211d);
        border:1px solid var(--cms-border,#43564a); border-radius:.5rem; padding:.5rem; min-height:48px; }
      button { cursor:pointer; } .source { flex:1 1 12rem; overflow-wrap:anywhere; }
      .actions { display:flex; justify-content:flex-end; gap:.5rem; flex-wrap:wrap; }
      [role=alert] { color:var(--cms-danger,#ffb4a8); }
      label { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
      input[type=checkbox] { min-height:0; width:1.2rem; height:1.2rem; }
      .condition-group { border:1px solid var(--cms-border,#43564a); border-radius:.6rem;
        margin:.5rem 0; padding:.5rem; min-width:0; }
      .group-actions { display:flex; flex-wrap:wrap; gap:.4rem; margin:.5rem 0; }
      .group-children { display:grid; gap:.5rem; }
      .condition-group .condition-group { margin-left:.5rem; }
      [hidden] { display:none !important; }
    </style>
    <form novalidate>
      <h3>Bedingung bearbeiten</h3>
      <label>Verknüpfung <select data-join><option value="and">Alle Regeln (UND)</option>
        <option value="or">Mindestens eine Regel (ODER)</option>
        <option value="xor">Ungerade Anzahl wahr (XOR)</option></select></label>
      <label><input type="checkbox" data-not> Gesamtergebnis umkehren (NICHT)</label>
      <p>Jede Gruppe ist eine Klammer. Mit „Gruppieren“ einzelne Regeln oder ganze Gruppen zusammenfassen.</p>
      <div data-rules></div>
      <button type="button" data-add>Regel hinzufügen</button>
      <button type="button" data-wrap-all>Alle Regeln in eine Untergruppe setzen</button>
      <label data-mode-row>Bei falscher Bedingung <select data-mode>
        <option value="collapse">Platz freigeben</option><option value="keep-space">Platz behalten</option>
      </select></label>
      <label data-else-row><input type="checkbox" data-else> Sonst-Zweig einfügen</label>
      <p data-preview role="status">Aktuelle Werte werden geladen …</p>
      <p data-error role="alert"></p>
      <div class="actions"><button type="button" data-cancel>Abbrechen</button><button type="submit">Übernehmen</button></div>
    </form>`;
    const $ = selector => dialog.querySelector(selector);
    const original = initial?.condition;
    const originalRules = structuredClone(original?.rules || [{device:'', reading:'', operator:'==', value:''}]);
    const fromExpression = node => Object.hasOwn(node, 'rule') ? {rule:originalRules[node.rule]}
      : {op:node.op, not:node.not === true, children:node.children.map(fromExpression)};
    const tree = original?.expression ? fromExpression(original.expression)
      : {op:original?.join || 'and', not:false, children:originalRules.map(rule => ({rule}))};
    $('[data-join]').value = tree.op;
    $('[data-not]').checked = tree.not;
    $('[data-mode-row]').hidden = !allowMode;
    $('[data-mode]').value = initial?.mode || 'collapse';
    $('[data-else-row]').hidden = !allowElse;
    $('[data-else]').checked = initial?.otherwise === true;
    let groups = new Map(), devices = [], pending = false, closed = false, loading = false, refreshPending = false;
    let timer, loadError = '';
    const flatten = () => {
      const rules = [];
      const convert = node => {
        if (node.rule) {
          rules.push(structuredClone(node.rule));
          return {rule:rules.length - 1};
        }
        return {op:node.op, ...(node.not ? {not:true} : {}), children:node.children.map(convert)};
      };
      return {rules, expression:convert(tree)};
    };
    const condition = () => {
      const {rules, expression} = flatten();
      const simple = !expression.not && ['and', 'or'].includes(expression.op)
        && expression.children.every(child => Object.hasOwn(child, 'rule'));
      return {join:simple ? expression.op : 'and', rules, ...(simple ? {} : {expression})};
    };
    const stats = () => {
      let nodes = 0, depth = 0, count = 0;
      const visit = (node, level) => {
        nodes++; depth = Math.max(depth, level);
        if (node.rule) count++;
        else node.children.forEach(child => visit(child, level + 1));
      };
      visit(tree, 1);
      return {nodes, depth, count};
    };
    const update = () => {
      try {
        const value = evaluateCondition(condition(), (device, reading) => lookupValue(groups, device, reading));
        $('[data-error]').textContent = '';
        $('[data-preview]').textContent = loadError ? `Aktuelle Werte nicht verfügbar: ${loadError}`
          : value === null ? 'Aktuelles Ergebnis: unbekannt'
          : `Aktuelles Ergebnis: ${value ? 'wahr' : 'falsch'}`;
      } catch (error) {
        $('[data-error]').textContent = error.message;
        $('[data-preview]').textContent = 'Aktuelles Ergebnis: unbekannt';
      }
    };
    const wrapChildren = group => {
      group.children = [{op:group.op, not:group.not, children:group.children}];
      group.op = 'and'; group.not = false;
      if (group === tree) { $('[data-join]').value = 'and'; $('[data-not]').checked = false; }
      render();
    };
    const render = () => {
      const container = $('[data-rules]');
      const {rules} = flatten();
      groups = groupSnapshots([...new Set(rules.map(rule => rule.device).filter(Boolean))], devices);
      let index = 0;
      const makeButton = (text, label, action, disabled = false) => {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = text; button.setAttribute('aria-label', label);
        button.disabled = disabled; button.addEventListener('click', action);
        return button;
      };
      const makeGroup = (group, depth, parent = null) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'condition-group';
        const legend = document.createElement('legend');
        legend.textContent = `Gruppe (Klammer), Ebene ${depth}`;
        fieldset.append(legend);
        const label = document.createElement('label');
        label.textContent = 'Verknüpfung ';
        const join = document.createElement('select');
        join.setAttribute('aria-label', `Verknüpfung Gruppe Ebene ${depth}`);
        join.append(new Option('Alle (UND)', 'and'), new Option('Mindestens eine (ODER)', 'or'),
          new Option('Ungerade Anzahl (XOR)', 'xor'));
        join.value = group.op;
        join.addEventListener('change', () => { group.op = join.value; update(); });
        label.append(join);
        const notLabel = document.createElement('label');
        const not = document.createElement('input');
        not.type = 'checkbox'; not.checked = group.not;
        not.setAttribute('aria-label', `Gruppe Ebene ${depth} umkehren`);
        not.addEventListener('change', () => { group.not = not.checked; update(); });
        notLabel.append(not, document.createTextNode(' NICHT (Gruppenergebnis umkehren)'));
        const children = document.createElement('div');
        children.className = 'group-children';
        group.children.forEach((child, position) => children.append(makeNode(child, group, depth, position)));
        const actions = document.createElement('div');
        actions.className = 'group-actions';
        const state = stats();
        actions.append(makeButton('Regel hinzufügen', `Regel zu Gruppe Ebene ${depth} hinzufügen`, () => {
          group.children.push({rule:{device:'',reading:'',operator:'==',value:''}}); render();
        }, state.count >= 20 || state.nodes >= MAX_CONDITION_NODES || depth >= MAX_CONDITION_DEPTH));
        actions.append(makeButton('Alle gruppieren', `Alle Einträge in Gruppe Ebene ${depth} gruppieren`,
          () => wrapChildren(group), state.nodes >= MAX_CONDITION_NODES || state.depth >= MAX_CONDITION_DEPTH));
        const position = parent.children.indexOf(group);
        actions.append(makeButton('↑', `Gruppe Ebene ${depth} nach oben`, () => {
          [parent.children[position - 1], parent.children[position]] = [group, parent.children[position - 1]]; render();
        }, position === 0));
        actions.append(makeButton('↓', `Gruppe Ebene ${depth} nach unten`, () => {
          [parent.children[position + 1], parent.children[position]] = [group, parent.children[position + 1]]; render();
        }, position === parent.children.length - 1));
        actions.append(makeButton('Gruppe auflösen', `Gruppe Ebene ${depth} auflösen`, () => {
          const position = parent.children.indexOf(group);
          parent.children.splice(position, 1, ...group.children); render();
        }));
        fieldset.append(label, notLabel, children, actions);
        return fieldset;
      };
      const makeNode = (node, parent, depth, position) => {
        if (!node.rule) return makeGroup(node, depth + 1, parent);
        const rule = node.rule;
        const ruleIndex = ++index;
        const row = document.createElement('div');
        row.className = 'rule';
        const source = document.createElement('button');
        source.type = 'button';
        source.className = 'source';
        source.textContent = rule.device && rule.reading ? `${rule.device}: ${rule.reading}` : 'Device und Reading auswählen …';
        source.addEventListener('click', async () => {
          if (pending) return;
          pending = true;
          try {
            const result = await openPlaceholderPicker({services, initial:rule.device ? rule : null, signal:pickerAbort.signal});
            if (!closed && result) {
              rule.device = result.device;
              rule.reading = result.reading;
              render();
              void refresh();
            }
          } catch (error) {
            if (!closed) $('[data-error]').textContent = `Auswahl fehlgeschlagen: ${error.message}`;
          } finally { pending = false; }
        });
        const operator = document.createElement('select');
        operator.setAttribute('aria-label', `Vergleich Regel ${ruleIndex}`);
        operator.append(...OPERATORS.map(([value, text]) => new Option(text, value)));
        operator.value = rule.operator;
        operator.addEventListener('change', () => { rule.operator = operator.value; update(); });
        const value = document.createElement('input');
        value.setAttribute('aria-label', `Vergleichswert Regel ${ruleIndex}`);
        value.maxLength = 1024;
        value.value = rule.value;
        value.addEventListener('input', () => { rule.value = value.value; update(); });
        const state = stats();
        row.append(source, operator, value,
          makeButton('↑', `Regel ${ruleIndex} nach oben`, () => {
            [parent.children[position - 1], parent.children[position]] = [node, parent.children[position - 1]]; render();
          }, position === 0),
          makeButton('↓', `Regel ${ruleIndex} nach unten`, () => {
            [parent.children[position + 1], parent.children[position]] = [node, parent.children[position + 1]]; render();
          }, position === parent.children.length - 1),
          makeButton('In Gruppe darüber', `Regel ${ruleIndex} in Gruppe darüber verschieben`, () => {
            const target = parent.children[position - 1];
            parent.children.splice(position, 1);
            target.children.push(node);
            render();
          }, position === 0 || Boolean(parent.children[position - 1]?.rule) || depth + 2 > MAX_CONDITION_DEPTH),
          makeButton('Gruppieren', `Regel ${ruleIndex} gruppieren`, () => {
            parent.children[position] = {op:'and', not:false, children:[node]}; render();
          }, depth + 2 > MAX_CONDITION_DEPTH || state.nodes >= MAX_CONDITION_NODES),
          makeButton('Entfernen', `Regel ${ruleIndex} entfernen`, () => {
            parent.children.splice(position, 1); render();
          }, state.count === 1 || parent.children.length === 1));
        return row;
      };
      container.replaceChildren(...tree.children.map((child, position) => makeNode(child, tree, 1, position)));
      const state = stats();
      $('[data-add]').disabled = state.count >= 20 || state.nodes >= MAX_CONDITION_NODES;
      $('[data-wrap-all]').disabled = state.nodes >= MAX_CONDITION_NODES || state.depth >= MAX_CONDITION_DEPTH;
      update();
    };
    const finish = result => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener('abort', abort);
      pickerAbort.abort();
      clearInterval(timer);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    const abort = () => finish(null);
    signal?.addEventListener('abort', abort, {once:true});
    $('[data-add]').addEventListener('click', () => {
      if (stats().count < 20 && stats().nodes < MAX_CONDITION_NODES) {
        tree.children.push({rule:{device:'',reading:'',operator:'==',value:''}});
      }
      render();
    });
    $('[data-wrap-all]').addEventListener('click', () => wrapChildren(tree));
    $('[data-join]').addEventListener('change', () => { tree.op = $('[data-join]').value; update(); });
    $('[data-not]').addEventListener('change', () => { tree.not = $('[data-not]').checked; update(); });
    $('[data-cancel]').addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    $('form').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const result = {condition:validateCondition(condition())};
        if (allowMode) result.mode = $('[data-mode]').value;
        if (allowElse) result.otherwise = $('[data-else]').checked;
        finish(result);
      } catch (error) { $('[data-error]').textContent = error.message; }
    });
    const refresh = async () => {
      if (loading) { refreshPending = true; return; }
      loading = true;
      try {
        const names = [...new Set(flatten().rules.map(rule => rule.device).filter(name => /^[A-Za-z0-9_.-]{1,64}$/.test(name)))];
        const items = typeof services.conditionSnapshots === 'function'
          ? await services.conditionSnapshots(names) : await services.listAllDevices({refresh:true});
        if (closed) return;
        if (!Array.isArray(items)) throw new Error('Ungültige Geräteliste');
        devices = items;
        loadError = '';
        groups = groupSnapshots([...new Set(flatten().rules.map(rule => rule.device).filter(Boolean))], devices);
        update();
      } catch (error) {
        if (!closed) {
          devices = [];
          groups = new Map();
          loadError = error.message || 'unbekannter Fehler';
          update();
        }
      } finally {
        loading = false;
        if (refreshPending && !closed) { refreshPending = false; void refresh(); }
      }
    };
    document.body.append(dialog);
    showCmsModal(dialog);
    render();
    void refresh();
    timer = setInterval(refresh, 30000);
  });
}
