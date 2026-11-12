export const dialogGroupStyles = `
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
