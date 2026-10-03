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

Нужен аккаунт Cloudflare (бесплатного плана достаточно) и Node.js 20+.

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create mtportfolio-photos   # R2 нужно один раз включить в дашборде Cloudflare (нужна карта, но 10 ГБ бесплатно)
npm run deploy                                     # выдаст адрес вида https://mtportfolio.<аккаунт>.workers.dev
npx wrangler secret put ADMIN_PASSWORD             # придумайте длинный пароль для Марии
```

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
