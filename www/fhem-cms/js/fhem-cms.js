import '../components/cms-device-card.js';

document.addEventListener('DOMContentLoaded', function () {
  var card = document.querySelector('cms-device-card');

  if (!card) {
    return;
  }

  card.status = 'Grundstruktur bereit. Die FHEM-Datenanbindung ist noch nicht implementiert.';
});
