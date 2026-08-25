const DOCMAC_CONFIG = {
  downloadUrl: 'https://github.com/jackbarisere8/DOCMAC/releases/latest/download/app-release.apk',
  releaseUrl: 'https://github.com/jackbarisere8/DOCMAC/releases/latest',
  version: 'v1.0.3'
};

document.addEventListener('DOMContentLoaded', () => {
  const downloadButton = document.getElementById('download-button');
  const version = document.getElementById('release-version');
  const year = document.getElementById('year');

  if (downloadButton) {
    downloadButton.href = DOCMAC_CONFIG.downloadUrl;
    downloadButton.setAttribute('aria-label', `Download Docmac ${DOCMAC_CONFIG.version} for Android`);
  }
  if (version) version.textContent = DOCMAC_CONFIG.version;
  if (year) year.textContent = new Date().getFullYear();

  const feedbackForm = document.getElementById('feedback-form');
  if (feedbackForm) {
    feedbackForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(feedbackForm);
      const name = form.get('name')?.trim() || 'Not provided';
      const email = form.get('email')?.trim() || 'Not provided';
      const topic = form.get('topic') || 'Website feedback';
      const message = form.get('message')?.trim() || '';
      const subject = `Docmac feedback: ${topic}`;
      const body = `Name: ${name}\nEmail: ${email}\nTopic: ${topic}\n\nFeedback:\n${message}`;
      window.location.href = `mailto:jackbarisere8@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }
});
