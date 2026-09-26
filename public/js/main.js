// Africa KNXION - main frontend script
(function () {
  const toggle = document.getElementById('navToggle');
  const nav = document.querySelector('.main-nav');
  const actions = document.querySelector('.header-actions');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
      if (actions) actions.classList.toggle('open');
    });
  }

  const alert = document.querySelector('[data-dismiss]');
  if (alert) {
    setTimeout(function () {
      alert.style.transition = 'opacity 0.4s ease';
      alert.style.opacity = '0';
      setTimeout(function () { alert.remove(); }, 400);
    }, 4000);
  }
})();
