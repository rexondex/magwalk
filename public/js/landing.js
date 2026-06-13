(function () {
  const loadingLinks = Array.from(document.querySelectorAll('.loading-link-button'));

  loadingLinks.forEach((link) => {
    link.addEventListener('click', () => {
      loadingLinks.forEach((nextLink) => {
        nextLink.classList.toggle('is-loading', nextLink === link);
        nextLink.setAttribute('aria-busy', String(nextLink === link));

        if (nextLink !== link) {
          nextLink.classList.add('disabled');
          nextLink.setAttribute('aria-disabled', 'true');
        }
      });
    });
  });
})();
