export const titleVisibilityField = `
  <label class="cms-title-visibility">
    <input name="showTitle" type="checkbox" checked> Titel anzeigen
  </label>`;

export const titleVisibilityStyles = `
  dialog[data-dialog] {
    box-sizing: border-box;
    width: min(94vw, 1100px);
    max-width: 94vw;
    max-height: 94vh;
    height: auto;
    overflow: auto;
  }
  .cms-title-visibility {
    display: flex !important;
    width: fit-content;
    max-width: 100%;
    align-items: center;
    justify-content: flex-start;
    gap: 0.4rem;
  }
  .cms-title-visibility > input[type="checkbox"] {
    width: 1.2rem;
    flex: 0 0 auto;
    margin: 0;
  }
`;

export const dialogGroupStyles = `
  ${titleVisibilityStyles}
  .config-group { min-width: 0; border: 1px solid var(--cms-border, #43564a); border-radius: 0.65rem; padding: 0.5rem 0.7rem; }
  .config-group > summary { cursor: pointer; color: var(--cms-muted, #a5c9b2); font-weight: 600; }
  .config-group > summary:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 3px; }
  .config-group[open] > summary { margin-bottom: 0.7rem; }
  .config-group-fields { display: grid; min-width: 0; gap: 0.75rem; }
  .config-group-fields > * { min-width: 0; }
  .config-group-fields .device-row, .config-group-fields .single-device {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .config-group-fields .device-row > *, .config-group-fields input, .config-group-fields select { min-width: 0; }
`;
