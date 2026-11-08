function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
}

function sameData(left, right) {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

export class MigrationController {
  #transport;
  #preview = null;
  #busy = false;
  #stopped = false;
  #generation = 0;

  constructor(transport) {
    if (!transport || ['previewMigration', 'previewRestore', 'migrate', 'restore']
      .some((name) => typeof transport[name] !== 'function')) {
      throw new Error('Migrationsdienste erforderlich');
    }
    this.#transport = transport;
  }

  #begin() {
    if (this.#stopped) throw new Error('Migrationsablauf wurde beendet');
    if (this.#busy) throw new Error('Migrationsaktion läuft bereits');
    this.#busy = true;
    this.#preview = null;
    return ++this.#generation;
  }

  async previewMigration(source, positions) {
    const generation = this.#begin();
    try {
      const expected = structuredClone(source);
      const plan = structuredClone(positions);
      const result = await this.#transport.previewMigration(structuredClone(plan));
      if (this.#stopped || generation !== this.#generation) throw new Error('Vorschau wurde verworfen');
      if (!sameData(expected, result.source)) throw new Error('Migrationsquelle hat sich geändert; bitte erneut laden');
      this.#preview = { action: 'migrate', payload: plan, result: structuredClone(result) };
      return structuredClone(result);
    } finally {
      this.#busy = false;
    }
  }

  async previewRestore(name) {
    const generation = this.#begin();
    try {
      const result = await this.#transport.previewRestore(name);
      if (this.#stopped || generation !== this.#generation) throw new Error('Vorschau wurde verworfen');
      this.#preview = { action: 'restore', payload: name, result: structuredClone(result) };
      return structuredClone(result);
    } finally {
      this.#busy = false;
    }
  }

  async commit(confirm) {
    if (this.#stopped) throw new Error('Migrationsablauf wurde beendet');
    if (this.#busy) throw new Error('Migrationsaktion läuft bereits');
    if (!this.#preview) throw new Error('Zuerst eine neue Vorschau prüfen');
    if (typeof confirm !== 'function') throw new Error('Explizite Bestätigung erforderlich');
    const preview = this.#preview;
    this.#busy = true;
    try {
      if (confirm(structuredClone({ action: preview.action, result: preview.result })) !== true) return null;
      if (this.#stopped || this.#preview !== preview) throw new Error('Vorschau wurde verworfen');
      this.#preview = null;
      const backup = await this.#transport[preview.action](preview.payload, preview.result.token);
      const verified = await this.#transport.previewRestore(backup);
      const expected = preview.action === 'migrate' ? preview.result.config : preview.result.backup;
      if (!sameData(verified.live, expected)) {
        throw new Error('Schreibvorgang nicht eindeutig verifiziert; Live-Stand und Sicherungen prüfen');
      }
      return backup;
    } finally {
      this.#busy = false;
    }
  }

  invalidate() {
    this.#preview = null;
    this.#generation += 1;
  }

  stop() {
    this.#stopped = true;
    this.invalidate();
  }
}
