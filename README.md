# Mariia Troian — сайт-портфолио с админкой

Сайт работает на **Cloudflare Workers** + **R2** (хранилище фото). Мария редактирует сайт на `/admin`.

```
public/            статика: style.css, script.js, favicon, стартовые фото (assets/), админка (admin/)
src/worker.js      сервер: вход, API админки, отдача фото из R2, отдача страницы
src/render.js      собирает HTML страницы из контента
src/content.js     проверка/очистка данных, которые присылает админка
src/default-content.json   стартовый контент (используется, пока в R2 нет content.json)
wrangler.jsonc     конфигурация Cloudflare
```

## Как это устроено

- Весь редактируемый контент (тексты, список фото, порядок, категории) лежит одним файлом `content.json` в R2.
- Фото лежат в R2 в папке `photos/`. Браузер Марии **сам уменьшает** фото перед загрузкой (до 2200 px + превью 900 px, WebP), поэтому снимки с телефона на 8 МБ грузятся быстро, а на сайте открываются мгновенно.
- Страница `/` собирается на сервере из `content.json` — Google и превью ссылок в соцсетях видят настоящий текст и фото.
- Изменения в админке попадают на сайт после нажатия **«Опубликовать»**.
- Стартовые 22 фото лежат в `public/assets/` и работают сразу; Мария может скрыть или удалить любое из них в админке (файл в репозитории при этом остаётся).

## Первый запуск (один раз)

Нужен аккаунт Cloudflare (бесплатного плана достаточно), в нём один раз включённый **R2** (Dashboard → R2 Object Storage → Enable; потребуется карта, но 10 ГБ бесплатно) и Node.js 20+.

**API-токен** (Dashboard → My Profile → API Tokens → Create Token → шаблон *Edit Cloudflare Workers*, и добавить право *Account → Workers R2 Storage → Edit*) и **Account ID** (Dashboard → справа на странице Workers & Pages).

```bash
npm install
export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=...   # либо просто `npx wrangler login`
npm run setup
```

`npm run setup` делает всё сам и его можно запускать повторно: создаёт бакет R2, деплоит сайт, ставит пароль админки (если не задан — генерирует и печатает его) и **переносит старые фото из `public/assets/` в R2** (`scripts/migrate-photos.mjs`; если в R2 уже есть опубликованный контент, он не перезаписывается).

После переноса папку `public/assets/photos` и `public/assets/thumbs` в репозитории можно удалить: сайт берёт фото из R2.

Админка: `https://<адрес сайта>/admin/`.

Свой домен: Cloudflare Dashboard → Workers & Pages → mtportfolio → Settings → Domains & Routes → Add → Custom domain.

Автодеплой из GitHub: Workers & Pages → mtportfolio → Settings → Builds → Connect → этот репозиторий (команда деплоя `npx wrangler deploy`).

> GitHub Pages больше не подходит: админке нужен сервер, а Pages умеет только статику.

## Локальная разработка

```bash
echo 'ADMIN_PASSWORD=test' > .dev.vars
npm run dev          # http://localhost:8787 , админка /admin/ ; R2 эмулируется локально
npm test
```

## Безопасность

- Вход по паролю (`ADMIN_PASSWORD`), сессия 30 дней в `HttpOnly`/`Secure`/`SameSite=Strict` куке; неверный пароль замедляется на ~1 с.
- Все записи проверяются сервером (`src/content.js`): допускаются только свои пути к фото, весь текст экранируется при выводе.
- Загрузка принимает только JPEG/WebP до 6 МБ.
- Хотите ещё надёжнее — закройте `/admin/*` и `/api/admin/*` через **Cloudflare Access** (Zero Trust, бесплатно до 50 человек): вход по коду на почту Марии, без паролей.
- Сменить пароль: `npx wrangler secret put ADMIN_PASSWORD` (все старые сессии сразу станут недействительны).

## Раздача фото напрямую из R2 (по желанию)

По умолчанию фото отдаёт Worker (`/img/...`) с кэшем на год. Чтобы отдавать их напрямую с CDN: R2 → бакет → Settings → Custom Domains (например `photos.example.com`) и в `wrangler.jsonc` раскомментировать `"vars": { "IMG_BASE": "https://photos.example.com" }`.
