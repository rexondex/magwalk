(function () {
  const form = document.querySelector('#signinForm');
  const authStatus = document.querySelector('#authStatus');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    authStatus.textContent = 'Signing in...';

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
      return;
    }

    window.location.href = '/main';
  });
})();
