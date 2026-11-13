export function createCmsAdminLink() {
  const link = document.createElement('a');
  link.className = 'cms-button';
  link.href = '../admin.html';
  link.textContent = 'Globale CMS Administration';
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}
