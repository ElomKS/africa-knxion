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

  // Auto-submit selects that used inline onchange handlers.
  document.querySelectorAll('select[data-submit]').forEach(function (select) {
    select.addEventListener('change', function () {
      this.form.submit();
    });
  });

  // Confirm deletes that used inline onsubmit handlers.
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) {
        e.preventDefault();
      }
    });
  });
})();
