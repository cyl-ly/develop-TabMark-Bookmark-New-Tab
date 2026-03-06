document.addEventListener('DOMContentLoaded', function () {
    const yearProgressContainer = document.getElementById('year-progress');
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59);
    const now = new Date();
    const yearProgress = ((now - startOfYear) / (endOfYear - startOfYear)) * 100;

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';

    for (let i = 0; i < 12; i++) {
        const progressSegment = document.createElement('div');
        if (i < Math.floor(yearProgress / 8.33)) {
            progressSegment.classList.add('active');
        }
        progressBar.appendChild(progressSegment);
    }

    const yearProgressElement = document.createElement('div');
    yearProgressElement.className = 'year-progress';
    const yearProgressText = chrome.i18n.getMessage('yearProgress');
    yearProgressElement.innerHTML = `<span>${currentYear} ${yearProgressText}</span>`;
    yearProgressElement.appendChild(progressBar);

    const progressPercentage = document.createElement('div');
    progressPercentage.className = 'progress-percentage';
    progressPercentage.textContent = `${yearProgress.toFixed(2)}%`;

    yearProgressContainer.appendChild(yearProgressElement);
    yearProgressContainer.appendChild(progressPercentage);

    function updateColors() {
        if (!window.WelcomeManager || typeof window.WelcomeManager.sampleBackgroundColor !== 'function') {
            return;
        }

        const yearTextSpan = yearProgressElement.querySelector('span');
        const activeSegments = progressBar.querySelectorAll('.active');
        const inactiveSegments = progressBar.querySelectorAll('div:not(.active)');

        window.WelcomeManager.sampleBackgroundColor().then((analysis) => {
            if (!analysis) {
                return;
            }

            const { r, g, b, brightness } = analysis;
            yearTextSpan.style.color = brightness > 128
                ? `rgba(${Math.max(0, r - 160)}, ${Math.max(0, g - 160)}, ${Math.max(0, b - 160)}, 0.75)`
                : `rgba(${Math.min(255, (255 - r) + 80)}, ${Math.min(255, (255 - g) + 80)}, ${Math.min(255, (255 - b) + 80)}, 0.75)`;
            yearTextSpan.style.textShadow = 'none';
            yearTextSpan.style.transition = 'color 0.3s ease';

            progressPercentage.style.color = yearTextSpan.style.color;
            progressPercentage.style.textShadow = 'none';
            progressPercentage.style.transition = 'color 0.3s ease';

            activeSegments.forEach(segment => {
                if (brightness > 128) {
                    const darkR = Math.max(0, r - 160);
                    const darkG = Math.max(0, g - 160);
                    const darkB = Math.max(0, b - 160);
                    segment.style.backgroundColor = `rgba(${darkR}, ${darkG}, ${darkB}, 0.3)`;
                } else {
                    const lightR = Math.min(255, (255 - r) + 80);
                    const lightG = Math.min(255, (255 - g) + 80);
                    const lightB = Math.min(255, (255 - b) + 80);
                    segment.style.backgroundColor = `rgba(${lightR}, ${lightG}, ${lightB}, 0.3)`;
                }
                segment.style.boxShadow = 'none';
                segment.style.transition = 'background-color 0.3s ease';
            });

            inactiveSegments.forEach(segment => {
                if (brightness > 128) {
                    segment.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.1)`;
                } else {
                    segment.style.backgroundColor = `rgba(255, 255, 255, 0.1)`;
                }
                segment.style.boxShadow = 'none';
                segment.style.transition = 'background-color 0.3s ease';
            });
        });
    }

    let colorFrame = null;
    const scheduleUpdateColors = () => {
        if (document.visibilityState !== 'visible') {
            return;
        }

        if (colorFrame) {
            cancelAnimationFrame(colorFrame);
        }

        colorFrame = requestAnimationFrame(() => {
            colorFrame = null;
            updateColors();
        });
    };

    scheduleUpdateColors();

    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (
                mutation.type === 'attributes' &&
                mutation.attributeName === 'style' &&
                mutation.target === document.body
            ) {
                scheduleUpdateColors();
            }
        });
    });

    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['style']
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            scheduleUpdateColors();
        }
    });
});
