export function showDevBanner(doc = document, browser = window) {
  const version = doc.querySelector('meta[name="fhem-cms-version"]')?.content || '';
  const params = new URLSearchParams(browser.location.search);
  if (doc.querySelector('.cms-local-banner')
      || !/^\d+\.\d+\.\d+-dev(?:[.-][0-9A-Za-z]+)*$/.test(version)
      || (params.get('mode') === 'preview' && params.get('cms-device-preview') === '1'
        && browser.parent !== browser)) return;

  const banner = doc.createElement('div');
  banner.className = 'cms-dev-banner';
  banner.textContent = 'TEST - DEV Version';
  banner.setAttribute('role', 'status');
  doc.body.prepend(banner);
  const update = () => doc.documentElement.style.setProperty('--cms-dev-banner-height', `${banner.offsetHeight}px`);
  new ResizeObserver(update).observe(banner);
  update();
}
