export function navigationDom(element) {
  class Observer {
    observe() {}
    disconnect() {}
  }
  element.ownerDocument = { defaultView: { ResizeObserver: Observer, MutationObserver: Observer } };
  element.clientWidth = 0;
  element.querySelectorAll = (selector) => {
    const name = selector.slice(1);
    const all = (node) => [node, ...node.children.flatMap(all)];
    return element.children.flatMap(all).filter((node) => node.className?.split(' ').includes(name));
  };
  element.querySelector = (selector) => element.querySelectorAll(selector)[0] || null;
}
