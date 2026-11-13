export function createCmsAdminLink() {
  const link = document.createElement('a');
  link.className = 'cms-button';
  link.href = '../admin.html';
  link.textContent = 'Globale FHEM-CMS Administration';
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

export function createCmsAdminMenuLinks(client) {
  return client.adminMenuEnabled === true ? [createCmsAdminLink()] : [];
}
