let userName = localStorage.getItem('userName') || 'Sowhale';

// 集中管理欢迎消息的颜色逻辑
const WelcomeManager = {
    colorCache: {
        lastBackground: null,
        lastTextColor: null
    },
    autoUpdateTimer: null,

    // 初始化方法
    initialize() {
        // 先检查欢迎语是否应该显示，再更新内容
        chrome.storage.sync.get(['showWelcomeMessage'], (result) => {
            const welcomeElement = document.getElementById('welcome-message');
            if (welcomeElement) {
                // 立即设置显示状态，避免闪烁
                welcomeElement.style.display = result.showWelcomeMessage !== false ? '' : 'none';
                
                // 只有在需要显示时才更新内容
                if (result.showWelcomeMessage !== false) {
                    this.updateWelcomeMessage(false); // 传入false表示不再检查显示状态
                }
            }
            
            // 继续其他初始化
            this.initializeColorCache();
            this.setupEventListeners();
            this.setupThemeChangeListener();
        });
    },

    // 更新欢迎消息
    updateWelcomeMessage(checkVisibility = true) {
        const now = new Date();
        const hours = now.getHours();
        let greeting;
        
        if (hours < 12) {
            greeting = window.getLocalizedMessage('morningGreeting');
        } else if (hours < 18) {
            greeting = window.getLocalizedMessage('afternoonGreeting');
        } else {
            greeting = window.getLocalizedMessage('eveningGreeting');
        }

        const welcomeMessage = `${greeting}, ${userName}`;
        const welcomeElement = document.getElementById('welcome-message');
        if (welcomeElement) {
            welcomeElement.textContent = welcomeMessage;
            
            // 只有在需要时才检查显示状态
            if (checkVisibility) {
                chrome.storage.sync.get(['showWelcomeMessage'], (result) => {
                    welcomeElement.style.display = result.showWelcomeMessage !== false ? '' : 'none';
                });
            }
            
            this.adjustTextColor(welcomeElement);
        }
    },

    // 初始化颜色缓存
    initializeColorCache() {
        const computedStyle = window.getComputedStyle(document.documentElement);
        const backgroundColor = computedStyle.backgroundColor;
        const backgroundImage = document.body.style.backgroundImage;
        
        // 计算初始文字颜色
        if (backgroundColor && backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
            const rgb = backgroundColor.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const brightness = (parseInt(rgb[0]) * 0.299 + parseInt(rgb[1]) * 0.587 + parseInt(rgb[2]) * 0.114);
                this.colorCache.lastTextColor = brightness > 128 ? 'rgba(51, 51, 51, 0.9)' : 'rgba(255, 255, 255, 0.9)';
            }
        }
        
        this.colorCache.lastBackground = backgroundImage !== 'none' ? backgroundImage : backgroundColor;
        this.colorCache.sampledBackground = backgroundImage !== 'none' ? backgroundImage : null;
        this.colorCache.sampledAreas = new Map();
        
        // 应用初始颜色
        const welcomeElement = document.getElementById('welcome-message');
        if (welcomeElement) {
            welcomeElement.style.color = this.colorCache.lastTextColor || 'rgba(51, 51, 51, 0.9)';
        }
    },

    getBackgroundContext() {
        const computedStyle = window.getComputedStyle(document.documentElement);
        return {
            backgroundColor: computedStyle.backgroundColor,
            backgroundImage: document.body.style.backgroundImage,
            isDarkMode: document.documentElement.getAttribute('data-theme') === 'dark'
        };
    },

    getSolidBackgroundAnalysis(backgroundColor) {
        if (!backgroundColor || backgroundColor === 'rgba(0, 0, 0, 0)' || backgroundColor === 'transparent') {
            return null;
        }

        const rgb = backgroundColor.match(/\d+/g);
        if (!rgb || rgb.length < 3) {
            return null;
        }

        const r = parseInt(rgb[0], 10);
        const g = parseInt(rgb[1], 10);
        const b = parseInt(rgb[2], 10);
        return {
            r,
            g,
            b,
            brightness: (r * 0.299 + g * 0.587 + b * 0.114)
        };
    },

    getReadableTextColor(brightness, alpha = 0.9) {
        return brightness > 128
            ? `rgba(51, 51, 51, ${alpha})`
            : `rgba(255, 255, 255, ${alpha})`;
    },

    getAreaCacheKey(element, sampleSize) {
        if (!element) {
            return `full:${sampleSize}`;
        }

        const rect = element.getBoundingClientRect();
        return [
            Math.round(rect.x),
            Math.round(rect.y),
            Math.round(rect.width),
            Math.round(rect.height),
            sampleSize
        ].join(':');
    },

    sampleBackgroundColor({ element = null, sampleSize = 50 } = {}) {
        const { backgroundColor, backgroundImage } = this.getBackgroundContext();

        if (!backgroundImage || backgroundImage === 'none') {
            return Promise.resolve(this.getSolidBackgroundAnalysis(backgroundColor));
        }

        if (this.colorCache.sampledBackground !== backgroundImage) {
            this.colorCache.sampledBackground = backgroundImage;
            this.colorCache.sampledAreas = new Map();
        }

        const cacheKey = this.getAreaCacheKey(element, sampleSize);
        const cachedAnalysis = this.colorCache.sampledAreas.get(cacheKey);
        if (cachedAnalysis) {
            return Promise.resolve(cachedAnalysis);
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.src = backgroundImage.slice(5, -2);

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = sampleSize;
                    canvas.height = sampleSize;

                    if (element) {
                        const elementRect = element.getBoundingClientRect();
                        const sampleArea = {
                            x: Math.max(0, elementRect.x),
                            y: Math.max(0, elementRect.y),
                            width: Math.max(1, Math.min(elementRect.width || sampleSize, window.innerWidth)),
                            height: Math.max(1, Math.min(elementRect.height || sampleSize, window.innerHeight))
                        };

                        const sourceArea = {
                            x: sampleArea.x * (img.width / Math.max(window.innerWidth, 1)),
                            y: sampleArea.y * (img.height / Math.max(window.innerHeight, 1)),
                            width: Math.max(1, sampleArea.width * (img.width / Math.max(window.innerWidth, 1))),
                            height: Math.max(1, sampleArea.height * (img.height / Math.max(window.innerHeight, 1)))
                        };

                        ctx.drawImage(
                            img,
                            sourceArea.x,
                            sourceArea.y,
                            sourceArea.width,
                            sourceArea.height,
                            0,
                            0,
                            sampleSize,
                            sampleSize
                        );
                    } else {
                        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
                    }

                    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
                    const data = imageData.data;
                    let r = 0;
                    let g = 0;
                    let b = 0;
                    let count = 0;

                    for (let index = 0; index < data.length; index += 4) {
                        r += data[index];
                        g += data[index + 1];
                        b += data[index + 2];
                        count++;
                    }

                    const analysis = {
                        r: Math.floor(r / count),
                        g: Math.floor(g / count),
                        b: Math.floor(b / count)
                    };
                    analysis.brightness = (analysis.r * 0.299 + analysis.g * 0.587 + analysis.b * 0.114);

                    this.colorCache.sampledAreas.set(cacheKey, analysis);
                    resolve(analysis);
                } catch (error) {
                    console.error('分析背景颜色失败:', error);
                    resolve(null);
                }
            };

            img.onerror = () => {
                console.error('背景图片加载失败');
                resolve(null);
            };
        });
    },

    // 调整文字颜色
    adjustTextColor(element) {
        const { backgroundColor, backgroundImage, isDarkMode } = this.getBackgroundContext();

        if (!backgroundImage || backgroundImage === 'none') {
            if (isDarkMode) {
                element.style.color = 'rgba(255, 255, 255, 0.9)';
                this.colorCache.lastTextColor = 'rgba(255, 255, 255, 0.9)';
                return;
            }

            const analysis = this.getSolidBackgroundAnalysis(backgroundColor);
            const textColor = analysis
                ? this.getReadableTextColor(analysis.brightness)
                : 'rgba(51, 51, 51, 0.9)';

            this.colorCache.lastTextColor = textColor;
            element.style.color = textColor;
            return;
        }

        const requestedBackground = backgroundImage;
        if (this.colorCache.lastBackground === requestedBackground && this.colorCache.lastTextColor) {
            element.style.color = this.colorCache.lastTextColor;
        } else {
            element.style.color = 'rgba(255, 255, 255, 0.9)';
        }

        this.sampleBackgroundColor({ element }).then((analysis) => {
            if (document.body.style.backgroundImage !== requestedBackground) {
                return;
            }

            if (!analysis) {
                if (!this.colorCache.lastTextColor) {
                    element.style.color = 'rgba(255, 255, 255, 0.9)';
                }
                return;
            }

            const textColor = this.getReadableTextColor(analysis.brightness);
            this.colorCache.lastBackground = requestedBackground;
            this.colorCache.lastTextColor = textColor;
            element.style.color = textColor;
            element.style.transition = 'color 0.3s ease';
        });
    },

    // 设置事件监听器
    setupEventListeners() {
        document.getElementById('welcome-message').addEventListener('click', () => {
            // 使用 chrome.i18n.getMessage 获取本地化的提示文本
            const newUserName = prompt(chrome.i18n.getMessage("namePrompt"), userName);
            if (newUserName && newUserName.trim() !== "") {
                userName = newUserName.trim();
                localStorage.setItem('userName', userName);
                this.updateWelcomeMessage();
            }
        });

    },

    // 添加主题变化监听方法
    setupThemeChangeListener() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'data-theme') {
                    const welcomeElement = document.getElementById('welcome-message');
                    if (welcomeElement) {
                        this.adjustTextColor(welcomeElement);
                    }
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    },

    startAutoUpdate() {
        this.stopAutoUpdate();

        const tick = () => {
            if (document.visibilityState !== 'visible') {
                this.autoUpdateTimer = null;
                return;
            }

            this.updateWelcomeMessage();
            this.autoUpdateTimer = window.setTimeout(tick, 60000);
        };

        this.autoUpdateTimer = window.setTimeout(tick, 60000);
    },

    stopAutoUpdate() {
        if (this.autoUpdateTimer) {
            clearTimeout(this.autoUpdateTimer);
            this.autoUpdateTimer = null;
        }
    }
};

// 导出给其他模块使用的方法
window.WelcomeManager = WelcomeManager;

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    WelcomeManager.initialize();
    WelcomeManager.startAutoUpdate();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            WelcomeManager.updateWelcomeMessage();
            WelcomeManager.startAutoUpdate();
        } else {
            WelcomeManager.stopAutoUpdate();
        }
    });
});
