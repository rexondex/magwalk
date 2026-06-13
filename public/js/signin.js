(function () {
  const form = document.querySelector('#signinForm');
  const authStatus = document.querySelector('#authStatus');
  const submitButton = document.querySelector('#signinButton');
  let isSubmitting = false;

  function setSubmitting(nextIsSubmitting) {
    isSubmitting = nextIsSubmitting;
    submitButton.disabled = nextIsSubmitting;
    submitButton.classList.toggle('is-loading', nextIsSubmitting);
    submitButton.setAttribute('aria-busy', String(nextIsSubmitting));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setSubmitting(true);
    authStatus.textContent = 'Signing in...';

    try {
      const response = await fetch('/api/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username.value,
          password: form.password.value,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        authStatus.textContent = result.message || 'Sign in failed.';
        setSubmitting(false);
        return;
      }

      window.location.href = '/main';
    } catch (error) {
      authStatus.textContent = `Sign in failed: ${error.message}`;
      setSubmitting(false);
    }
  });
})();
