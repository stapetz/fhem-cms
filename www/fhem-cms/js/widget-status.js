export const widgetStatusStyles = `
  .cms-widget-status[data-loading] {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.7em;
  }
  .cms-widget-status[data-loading]::before {
    content: "";
    width: 1em;
    aspect-ratio: 1;
    box-sizing: border-box;
    border: 0.16em solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: cms-widget-status-spin 0.8s linear infinite;
  }
  @keyframes cms-widget-status-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cms-widget-status[data-loading]::before {
      animation: none;
      border-right-color: currentColor;
      border-top-color: transparent;
    }
  }
`;

export function setWidgetStatus(node, text, { error = false, loading = false } = {}) {
  node.textContent = text;
  node.toggleAttribute('data-error', error);
  node.toggleAttribute('data-loading', loading);
  node.setAttribute('aria-busy', String(loading));
  node.hidden = !text;
}
