(function () {
  const form = document.querySelector('#signupForm');
  const authStatus = document.querySelector('#authStatus');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    authStatus.textContent = 'Creating account...';

    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.value,
        password: form.password.value,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      authStatus.textContent = result.message || 'Sign up failed.';
      return;
    }

    window.location.href = '/main';
  });
})();
