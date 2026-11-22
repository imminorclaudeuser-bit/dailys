# Использованные инструменты

## Платформа и библиотеки
| Что | Для чего | Лицензия |
|---|---|---|
| **Node.js 22+** (`http`, `crypto`, встроенный `node:sqlite`) | сервер, API, база, сессии, scrypt-хэши паролей — без npm-зависимостей | MIT |
| Ванильный JavaScript, HTML, CSS, SVG, Canvas, Web Audio | весь интерфейс, генеративные карточки, анализ фото и BPM песни | — |
| **GSAP 3.13 + ScrollTrigger** | плавные появления, счётчики, «всплывающие» дни календаря | GSAP Standard (no-charge) |
| **MediaPipe Face Landmarker + Image Classifier (EfficientNet-Lite0)** | выражение лица (52 blendshapes → FACS/EMFACS эмоции) и предметы в видео — на устройстве | Apache 2.0 |
| **Whisper base** через **transformers.js** (ONNX Runtime Web) | голосовые сообщения → текст и субтитры, на устройстве, в Web Worker | MIT / Apache 2.0 |
| Web Speech API (`speechSynthesis`) | озвучка записи голосом, подобранным по настроению | браузер |
| MediaRecorder, getUserMedia | запись видео и голоса | браузер |

## Внешние API и сервисы
| Сервис | Для чего |
|---|---|
| **Apple iTunes Search API** | поиск песни по названию и 30-секундные превью |
| **Open-Meteo** | погода дня (без ключа) |
| **Google OAuth 2.0** (PKCE) | вход через Google |
| YouTube-nocookie / Spotify embed | встраивание песни по ссылке |
| **Railway** | хостинг (Node + постоянный том) |
| Google Fonts | Rethink Sans, Hedvig Letters Serif, Caveat, Pangolin, DM Sans (только буква W) |

## Готовые ресурсы
- Фото для примеров дней — **Wikimedia Commons**, CC BY-SA / CC BY (авторы в `public/demo/CREDITS.txt`, показываются на сайте).
- Музыка демо-дней и видео — синтезирована кодом (без чужих треков).
- Иконки, лица настроений, тюлень Дейзи, логотип — нарисованы вручную в SVG/Canvas.

## AI-инструменты при разработке
- **Claude Code (Anthropic, модель Claude Opus 5.5)** — помощь в написании кода, отладке, тестах, текстах интерфейса и видео.
- **Playwright (Chromium) + ffmpeg** — рендер видео-презентации и изображений карточек.
- Railway CLI — развёртывание.
