# Дневничок (Daily’s)

Личный дневник воспоминаний. Человек пишет, как прошёл день, прикладывает фото и песню, а система собирает из этого воспоминание: оформление, короткое название папки, озвучку. Дни складываются в архив.

Задание: Genesis Hackathon, ArtTech, «Make the Invisible Visible».

## Запуск

Нужен Node.js 22.13 или новее. Больше ничего ставить не надо: внешних пакетов нет, база данных встроена в Node (SQLite).

```
node server.js
```

Откройте http://127.0.0.1:3000. Кнопка «Попробовать как гость» создаёт временный аккаунт и сразу заполняет дневник шестью примерами.

Проверки: `npm test` (38 проверок безопасности API и 10 проверок движка оформления).

Настройки через переменные окружения: `PORT`, `HOST`, `DATA_DIR` (где лежат база и файлы), `COOKIE_SECURE=1` (когда сайт за HTTPS), `TRUST_PROXY=1` (когда сайт за обратным прокси), `REG_PER_HOUR`, `GUEST_PER_HOUR`.

## Что внутри

| Файл | Назначение |
|---|---|
| `server.js` | сервер: API, база SQLite, вход, защита |
| `public/engine.js` | движок оформления: анализ текста, фото, песни, выбор приёма, палитра, рисование карточки |
| `public/app.js` | экраны и обмен с сервером |
| `public/i18n.js` | interface texts in English and Russian, language switch (English by default) |
| `public/play.js` | interactive shapes and wobbly lines that react to the cursor (hero, section 02, Write a day) |
| `public/face.js` | face-mood camera: reads facial expressions on the device (MediaPipe in `public/vendor/mediapipe/`) |
| `public/demo/` | real photos for the example days, credits in `CREDITS.txt` |
| `moderation.js` | word guard: blocks abusive words, flags risky ones for the admin |
| `public/motion.js` | apple.com-style motion: fade-up on view, words lighting up, card tilt, page transitions |
| `public/style.css` | стили |
| `test/` | автоматические проверки |

## База данных

SQLite, один файл `data/memoir.db`. Четыре таблицы:

- `users`: e-mail, хэш пароля, признак гостя.
- `sessions`: хэш токена сессии, CSRF-токен, срок действия.
- `days`: дата, название папки, настроение, приём, текст, остальное оформление в JSON.
- `media`: фото и аудио дня (сами файлы лежат в `data/media/<пользователь>/`).

Фото и песни хранятся файлами на диске, в базе только записи о них. Все запросы к базе подготовленные, строки в SQL не склеиваются.

## Как работает оформление

Всё считается по явным правилам, поэтому каждое решение можно объяснить (экран «Что мы услышали»).

1. Текст: словарь слов-настроений, места, люди, время суток, сезон. Слова с отрицанием («не спешу») не считаются.
2. Фото: главные цвета, яркость, самый звонкий цвет (подмешивается в палитру).
3. Песня: темп и лад (для загруженного файла темп считается по звуку), энергия громкости.
4. По желанию и с согласия: дата, погода (Open-Meteo), геолокация.
5. Настроение (тёплое, напряжённое, тихое, шумное) выбирает приём:

| Настроение | Приём | Почему |
|---|---|---|
| Тёплое, спокойное | Мазки и свет в духе импрессионистов, Клода Моне | мягкий свет и размытые границы передают покой |
| Напряжённое | Геометрия в духе Кандинского | сетка, жёсткие линии и один акцент передают собранность |
| Тихое | Японская минималистичная графика | пустое место и один акцент передают тишину |
| Шумное | Коллаж и плёночное зерно | яркие плоские пятна и неровная рамка передают шум |

Постоянные элементы ленты: формат 4:5, дата сверху слева, песня справа, рамка фото, название и рукописная подпись снизу, три шрифта. Переменные: палитра, фактура, композиция, ритм смены кадров.

## Безопасность

Что уже сделано:

- Пароли хранятся только как хэш scrypt (с солью). Ответы на неверный пароль и неизвестный e-mail одинаковы по тексту и по времени.
- Сессия: случайный токен в cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` за HTTPS); в базе лежит только хэш токена; срок 14 дней; выход сразу делает сессию недействительной.
- Защита от CSRF: проверка `Origin` и отдельный CSRF-токен на каждый изменяющий запрос.
- Заголовки: строгая политика CSP (скрипты только свои, без inline-кода), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, запрет доступа к камере и микрофону.
- Ограничения частоты: общие, на вход (по IP и по аккаунту), на регистрацию, на гостей, на запись.
- Данные каждого человека изолированы: любой запрос к дню или файлу проверяет владельца. Чужой день отвечает «не найдено».
- Загрузки: тип проверяется по содержимому файла (не по имени), SVG и произвольные файлы не принимаются, размеры ограничены, имена файлов на диске генерирует сервер.
- Все входные данные проверяются по схеме: длина, диапазоны, допустимые символы, цвета палитры. Весь вывод экранируется. Ссылки только `http` и `https`.
- Персональное: геолокация округляется до 0,01° (около километра) и сохраняется только по согласию; можно удалить день и весь аккаунт со всеми файлами; гостевые аккаунты удаляются через 7 дней.

Что нужно сделать при выкладке в интернет:

- Поставить перед сервером HTTPS (например, Caddy или nginx) и запустить с `COOKIE_SECURE=1 TRUST_PROXY=1 HOST=127.0.0.1`.
- Делать резервные копии папки `data/`.
- Не открывать порт приложения наружу, только порт прокси.
- Следить за обновлениями Node.js.
- Для настоящих пользователей добавить подтверждение e-mail и восстановление пароля.

## Использованные инструменты

Node.js (http, crypto, SQLite), нативный JavaScript без библиотек, Web Audio (анализ темпа), Web Speech (озвучка), View Transitions API, Open-Meteo (погода, по согласию), шрифты Google Fonts (Playfair Display, Manrope, IBM Plex Mono, Caveat). Музыка пользователя не копируется: ссылки на сервисы встраиваются плеером YouTube и Spotify, свои файлы хранятся у владельца. Демонстрационная мелодия генерируется кодом.

## Admin, word guard and face camera

- **Admin.** Start the server with your e-mail: `ADMIN_EMAIL=you@example.com node server.js`, then register (or log in with) that e-mail. An "Admin" link appears in the sidebar for that account only. There you can review flagged entries, change a day's mood, title or text, delete days, edit the mood names and descriptions (EN/RU), and add your own blocked or flagged words. The site's code cannot be changed from the admin page.
- **Word guard** (`moderation.js`). Abusive words in English and Russian stop a day from being saved ("please rephrase"). Risky phrases (self-harm, violence) let the day save but mark it for the admin. It is a word list, not a language model.
- **Face camera.** On "Write a day", "Turn on camera" reads facial expressions with Google MediaPipe Face Landmarker (Apache 2.0). Everything runs in the browser; no video is recorded or uploaded. The reading is added to the mood together with the text, photos and song. The camera only works on `localhost` or over HTTPS.

## Moods, themes and motion

- Layout: centred content and a navigation bar at the bottom of the screen; on the welcome page the bar marks the section on screen and scrolls smoothly to the one you pick.
- Mood colours appear only inside section 02 (tap a mood or type a feeling, e.g. "I was sad") and on "Write a day" while you type. Clearing the text returns the base colours.
- Light/dark switch (sun/moon) in the bottom bar; it follows the system until you pick one.
- Motion follows apple.com: only opacity and transform are animated, with short curves; the shapes canvas pauses off screen and costs well under 1 ms per frame, so the site stays at the screen's own 60–120 fps.

## Google sign-in

"Continue with Google" appears on the sign-in card once three settings are present (put them in a git-ignored `.env` and run `npm start`):

1. In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** of type **Web application**.
2. Add the redirect URI `http://127.0.0.1:3000/api/auth/google/callback` (or your HTTPS address + the same path).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PUBLIC_URL` (e.g. `http://127.0.0.1:3000`).

The flow is OAuth 2.0 authorization code with PKCE, a one-time `state` in a signed short-lived cookie and an OpenID `nonce`; the secret never reaches the browser. A new Google e-mail creates an account (with the Google first name for the greeting); an existing account with the same verified e-mail is signed in. Google-only accounts have no password, so password login for them is impossible.

## Voice messages, atmosphere video and song search

- **Voice message.** On "Write a day", "Record a voice message" (up to 3 minutes). Choose the language you speak (EN/RU) next to the button; this also switches the whole site to that language. Speech becomes text with **OpenAI Whisper base** (MIT), run in the browser through **transformers.js 3.8.1** and ONNX Runtime Web (Apache 2.0), in a background worker. The model files are served from this site (`public/models/whisper-base`, ~77 MB, downloaded once by the browser and then cached). Subtitles show with time stamps; "Add the words to the entry" puts them into the text. The recording is uploaded only if "Keep the voice message in the day" is on; it then plays in the day's folder with the subtitles following along.
- **Camera: face and atmosphere (one window).** "Open the camera" shows the live face reading and a "Record video" button (up to 30 s; "Switch camera" changes front/back). While filming, the face is read in every frame from the same camera. After filming, the window shows the full AI scan: an overall guess, the face part (how long a face was in view, the main expressions, the mood split and a 20-step timeline) and the atmosphere part (brightness, colour warmth and strength, motion, loudness and what is in the frame, via MediaPipe Image Classifier with EfficientNet-Lite0, Apache 2.0, ImageNet labels in English). The face counts for up to half of the overall guess, depending on how long it was visible. An uploaded video (up to 30 s / 40 MB) gets the same scan; its face is read from 12 frames. The person must pick the true mood before saving. That choice counts three times as much as one text clue; the AI guess counts for nothing on its own. The video and the scan summary are kept in the day.
- **Song by name.** "Search by name" asks the iTunes Search API (no key needed) through this server and shows songs with their artist, year and cover. You only pick the song; tempo and key are not asked for. The tempo is measured from Apple's 30-second preview (or your own file) in the background; a plain link uses a medium tempo. The server only fetches previews from Apple's own hosts.
- **Face camera rules.** Facial movements (MediaPipe blendshapes) are turned into FACS action units, and the emotions follow the EMFACS combinations (Ekman & Friesen): happiness AU6+AU12, sadness AU1+AU4+AU15, surprise AU1+AU2+AU5+AU26, fear AU1+AU2+AU4+AU5+AU20+AU26, anger AU4+AU5+AU7+AU23, disgust AU9+AU15+AU16, contempt as a one-sided smile/dimple (AU14). Each person's resting face is measured first, so only changes from it count.
- Camera and microphone are allowed only for this site (`Permissions-Policy: camera=(self), microphone=(self)`).

## Customising "Write a day"

"Customize page" on "Write a day" opens a panel: the order of the cards (arrows), hide the camera card, the optional settings or the voice message, one or two columns, an accent colour, the entry font (serif, sans, handwriting) and text size, a heading of your own and the moving background shapes. The settings are saved to the account (`PUT /api/prefs`, only known values are kept; the heading is at most 60 characters without HTML characters) and follow you to other devices. While you type, the mood colours still take over the page.

## Deploying (Railway)

The site runs on Railway: project `dailys`, service `web`, a volume mounted at `/data`, and the variables `DATA_DIR=/data`, `HOST=0.0.0.0`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`, `ADMIN_EMAIL`. Railway sets `PORT` and provides HTTPS. `.railwayignore` keeps `.env`, `data/` and `test/` out of uploads (Railway does not read `.gitignore` for `railway up`).

To publish a new version from this folder:

```bash
~/.railway-cli/node_modules/.bin/railway up --service web
```

Google sign-in on the live site needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PUBLIC_URL=https://<domain>` set in Railway, and `https://<domain>/api/auth/google/callback` added as a redirect URI in Google Cloud Console.

## Welcome page details

- The first screen's title and line write themselves word by word, like the text in section 01 (`[data-words]`, CSS transitions).
- **Section 01** has a rolling wall made from the six example days: their photos and sentences (each with its mood face and date) in four columns that roll up and down, and a row of feeling words sliding sideways. It only moves while it is on screen and pauses under the cursor. Diaries are private by default. On a day's page the author can switch on **Share on the welcome wall** (`PUT /api/days/:id/share`); the public `GET /api/wall` then lists the newest 24 shared days that moderation did not flag, with only the date, the mood, the text cut to 220 characters, the first photo and the video, and never a name. `/api/wall/media/:id` serves only those files and only while the day is shared. Shared days lead the wall and the example days fill the rest; the admin can take any day off the wall.
- **Section 03** is a cork board with three sticky notes held by pushpins; they are pinned up one by one (GSAP `back.out`, the pins drop with `bounce.out`). Calendar faces drop in the same way.
- **Section 04**: the Log in / Sign up switch slides (fast, then slow) and only the form changes, without drawing the page again. Until the server says how people can sign in, the card shows a shimmering skeleton. Example e-mails type themselves into the empty field, and "Suggest a strong password" fills in a password made on the device in Apple's easy style (`abcdef-Ghijk2-mnopqr`), with a Copy button.
- **Daisy's lifebuoy**: after two nudges with nobody around she jumps into a lifebuoy and floats as a small round icon. Drag her anywhere, tap for a splash and a line, tap twice to bring her back. Her drawing has room around it, so her jumps are never cut off. She is a plain fixed element, and page changes only fade the page content, so she, the bar and the texture always stay on top.
- Small specks and halftone grains drift up over the whole site (16 CSS-animated dots, none with "Reduce motion").

## Buttons and switches

Buttons follow a few animation and UX laws: a raised 3D edge you press into with a slight squash and a springy release, a small lift on hover, a ripple from the point you pressed, press in 80 ms and release under 400 ms, and 7 px of extra tap room around every button (Fitts). Submit on "Write a day" is the main action: 64 px tall, at least 340 px wide, in the chosen accent colour, with an arrow that nudges forward. Every switch group (rows of pills, the EN/RU switches) gets a knob that slides to the chosen option on `expo.out`, like Log in / Sign up; when a click draws the page again, the knob starts from where it was (`Motion.segs`). On/off switches stretch while pressed. Page changes draw the new page and fade it in (0.35 s, GSAP); the browser's View Transitions are used only for the light/dark circle, because a page transition draws the page above everything (cards covered the bar and Daisy, titles doubled). Renders still queue one at a time with a 4 s safety limit.

## Write a day: the whole window

On "Write a day" the moving shapes and wobbly lines (`play.js`, option `wide`) span the full window width, not only the centre column, and react to the cursor anywhere. The number of shapes grows with the page size (14–48). When the text shows a mood, the whole window fades to that colour at once (the page column stays see-through).

## 10-second check-in

At the top of "Write a day": tap one of four mood faces, write one line, press Save (or Enter). The day is saved with that mood (`forceMood`), no photo and no song, and you land on the calendar where it pops in. In the full form a photo and a song are optional too: the server accepts 0–8 photos and an empty song link. A card without a photo shows the words in the frame instead, and the day page hides empty rows.

## On this day

At the top of "Write a day", a card shows up to three days written on today's date before: 1–5 years ago, 1–11 months ago, or exactly a week ago (dates like the 31st or 29 February only match where they exist). Labels come from the browser (`Intl.RelativeTimeFormat`: "last year", "в прошлом месяце"…). Each opens the day; Daisy points at them once a day. Nothing is shown when there is no match.

## Daily reminder

In the profile: "Remind me every day" and a time (saved as `prefs.remind`, only `HH:MM` or off). "Add to my phone's calendar" downloads `dailys-reminder.ics`, a daily repeating event with an alert and a link to "Write a day", so the phone or computer reminds even when the site is closed; no push server is needed. While the site is open, a check once a minute (after the time, once a day, only if nothing is written today) makes Daisy wave and, if the browser allowed notifications and the tab is in the background, shows a notification that opens "Write a day".

## Profile, calendar and the monthly recap

- **Profile** (`#/profile`, the round picture in the bottom bar): nickname (1–40 characters) and a profile picture. The browser cuts the picture to a 256×256 JPEG square; the server keeps only a JPEG/PNG/WebP data URL up to 120 KB (`PUT /api/profile`). The page also shows days, words and photos so far, and holds the settings: theme, language, accent colour, Daisy, moving shapes and a link to customise “Write a day”. It also has the buttons to log out or delete the account. On phones the theme and language switches live here instead of in the bar.
- **Calendar** (`#/calendar`, `#/calendar/YYYY-MM`): each day you wrote pops up in its mood colour with a small drawn face (our own SVG faces, not system emoji): warm with happy closed eyes, tense with a zigzag mouth, quiet with sleepy eyes and a rain drop, lively with star eyes. A number shows when a day has several entries; a tap opens the day, a tap on an empty past day starts writing for that date. A legend under the grid explains the colours.
- **Monthly recap** under the calendar: days, words, photos, songs, longest streak, voice messages and videos, the mood mix, photos and songs of the month, the longest note and a list of everything written. During the month it is shown as “so far”; from the last day it is the full recap, and in a new month the calendar points to last month's recap once.

## Motion (GSAP)

`public/vendor/gsap.min.js` and `ScrollTrigger.min.js` (GSAP 3.13.0 from npm, checksum checked, GSAP's no-charge licence) run all page motion in `public/motion.js`. Sections further down the page rise in with `ScrollTrigger.batch` (what is already on screen just appears, because the page change itself fades the page in), the big text writes itself word by word with CSS transitions, tiles tilt with `gsap.quickTo`, results and recap numbers count up on `expo.out`, and calendar days pop in with `back.out`. Each page's animations are made in a `gsap.matchMedia()` that is reverted on the next page; with "Reduce motion" everything is shown at once. Pages render one at a time (a queue in `render()`), only the page content takes part in page changes, and Daisy breathes as one composited layer instead of redrawing her drawing every frame. The emotion words on the welcome page start at section 01 (a sticky rail beside sections 01–04), not on the first screen.

## Daisy the seal and the results motion

- **Daisy** (`public/daisy.js`) is the site's friend: an original seal drawn in a flat, rounded mascot style (no outlines, big eyes, lighter belly, a daisy on her head). She breathes, blinks and follows the cursor with her eyes. She turns the colour of the mood you choose (section 02, the video's true mood, the face camera) or the one your text shows. Hovering or focusing a closing button makes her sad with a goodbye ("See you later!"). After 25 seconds without any input she waves and suggests the next step for the page you are on (at most three times until you are back). Click her for a word. When the words you type show a mood ("sad", "happy"…), she answers once and the page takes that mood's colours. "Customize page" has a switch to hide her; "Reduce motion" stops her animations.
- **Daisy's reactions.** She is made of felt (stitched seams, halftone blush, a halftone shadow that shrinks when she jumps) and reacts to what you do: a cheer with petals of the mood colour when you choose a mood, save a day or log in; she leans in with typing dots while you type and cheers at 25, 80 and 200 words; she dances with notes for a song, makes big eyes for photos, drag-and-drop and the camera, nods at a voice message or the customise panel, falls asleep (z z z) in dark mode and stretches in light mode, says hi in the new language, shakes her head with a sweat drop on an error, leans forward over Submit and spins after five quick pokes.
- **Felt and halftone.** One fixed felt layer (a 256 px fine-grain bitmap drawn once on a canvas in `motion.js`, a light and a dark version, no patches) lies over the whole page; it is drawn once, so scrolling stays smooth. Halftone dots are made in `motion.js` as small SVG masks: two slowly turning halftone suns in the first screen and in section 02 (in the mood's colour), dots in the top corner of every card (in the chosen accent), dotted bars and section numbers, and some of the moving shapes are printed in dots. Cards have a stitched seam like felt patches.
- **Results motion.** The AI scan appears like apple.com: parts rise one after another, bars grow from zero and the percentages count up, all on an exponential ease-out (fast at the start, slow at the end).
