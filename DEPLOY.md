# Как выложить проект в интернет и продолжать разработку

Есть два основных варианта: **один сервер** (проще) и **раздельный хостинг** (гибче).

---

## Вариант 1: Один сервер (рекомендуется для старта)

Бэкенд и фронт работают с одного домена. База — MongoDB Atlas (облако).

### Шаг 1. База данных в облаке (MongoDB Atlas)

1. Зайдите на [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas), зарегистрируйтесь.
2. Создайте бесплатный кластер (M0).
3. **Database Access** → Add User → логин и пароль (запомните).
4. **Network Access** → Add IP Address → **Allow Access from Anywhere** (0.0.0.0/0) для доступа с любого хостинга.
5. **Database** → Connect → **Drivers** → скопируйте строку подключения. Она вида:
   ```text
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/farm_portal?retryWrites=true&w=majority
   ```
   Подставьте свой пароль вместо `PASSWORD`.

### Шаг 2. Хостинг приложения

Подойдёт любой сервер с Node.js (VPS или PaaS).

**Примеры:**
- **Railway** ([railway.app](https://railway.app)) — есть бесплатный уровень, деплой из GitHub.
- **Render** ([render.com](https://render.com)) — бесплатный tier для веб-сервисов.
- **VPS** (Timeweb, Selectel, DigitalOcean и т.п.) — полный контроль, нужно самому ставить Node и настраивать.

Ниже — общая схема для **любого** такого хостинга.

### Шаг 3. Подготовка к деплою

**Локально в папке проекта:**

1. Собрать фронт:
   ```bash
   cd client
   npm install
   npm run build
   cd ..
   ```

2. В корне или в `server` создать/заполнить `.env` для продакшена (на сервере те же переменные задать в панели хостинга):

   ```env
   NODE_ENV=production
   PORT=5000

   MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/farm_portal?retryWrites=true&w=majority

   JWT_SECRET=придумайте-длинный-случайный-ключ-для-продакшена
   JWT_REFRESH_SECRET=другой-длинный-ключ-для-refresh

   CLIENT_URL=https://ваш-домен.ru
   ```

3. Один раз заполнить базу (роли, права, админ):
   ```bash
   cd server
   node seeds/initial.js
   ```
   Логин/пароль админа смотрите в выводе (по умолчанию admin@farm.com / admin123 — смените после первого входа).

### Шаг 4. Запуск на сервере

**Если хостинг даёт только Node (Railway, Render и т.п.):**

В корне проекта есть `package.json` с командами:
- **Build:** `npm run build` (соберёт фронт в `client/dist`)
- **Start:** `npm run start` (запустит сервер из `server/`)

В панели хостинга укажите:
- **Root directory:** корень репозитория (где лежат `client`, `server`, корневой `package.json`).
- **Build command:** `npm run build`
- **Start command:** `npm run start`
- Переменные окружения: MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET, CLIENT_URL, NODE_ENV=production, PORT (если нужен).

**Если у вас VPS (свой сервер):**

1. Установите Node.js (например, 18 или 20).
2. Склонируйте/залейте проект на сервер.
3. В корне:
   ```bash
   cd client && npm ci && npm run build && cd ..
   cd server && npm ci
   ```
4. Создайте `server/.env` с теми же переменными (MONGODB_URI, JWT_*, CLIENT_URL, PORT).
5. Запустите один раз сиды: `cd server && node seeds/initial.js`.
6. Запуск сервера (для проверки):
   ```bash
   cd server && npm start
   ```
   Для постоянной работы используйте PM2 или systemd (см. ниже).

### Шаг 5. Домен и HTTPS

- В панели хостинга привяжите домен к вашему сервису.
- Установите **CLIENT_URL** в виде `https://ваш-домен.ru` (без слэша в конце).
- На VPS можно поставить Nginx как прокси и выдать HTTPS (Let's Encrypt).

---

## Вариант 2: Фронт и бэкенд на разных сервисах

- **Фронт:** Vercel / Netlify (деплой из папки `client`, build: `npm run build`, output: `dist`).
- **Бэкенд:** Railway / Render / Fly.io (деплой папки `server`).
- **База:** MongoDB Atlas, как в варианте 1.

На фронте задайте переменную сборки:

- **VITE_API_URL** = URL бэкенда, например `https://ваш-бэкенд.railway.app`

В CORS на бэкенде в **CLIENT_URL** укажите URL фронта (например, `https://ваш-проект.vercel.app`).

---

## Продолжение разработки

1. **Код в Git (GitHub/GitLab)**  
   - Инициализируйте репозиторий в папке проекта, закоммитьте код, запушьте в GitHub/GitLab.  
   - Так будет бэкап и история, плюс удобный деплой (хостинги подтягивают обновления из репозитория).

2. **Работа локально**  
   - Разработка: в одном терминале `cd server && npm run dev`, в другом `cd client && npm run dev`.  
   - База: либо локальный MongoDB (Docker: `docker-compose up -d`), либо та же MongoDB Atlas с отдельной БД (например, `farm_portal_dev` в MONGODB_URI).

3. **Обновление онлайн-версии**  
   - При деплое из Git: сделали коммит и пуш — хостинг сам пересоберёт и перезапустит.  
   - При ручном деплое: снова `cd client && npm run build`, затем перезапуск сервера (или передеплой бэкенда).

4. **Секреты**  
   - В репозиторий не кладите `.env` и пароли. Добавьте `.env` в `.gitignore`. На сервере переменные задавайте в панели хостинга или в отдельном конфиге.

---

## Краткий чеклист перед выкладкой

- [ ] MongoDB Atlas: кластер создан, пользователь и строка подключения готовы.
- [ ] В MONGODB_URI подставлен правильный пароль.
- [ ] JWT_SECRET и JWT_REFRESH_SECRET заменены на свои длинные случайные строки.
- [ ] CLIENT_URL на продакшене = ваш реальный URL (например, https://ваш-домен.ru).
- [ ] Выполнен `node seeds/initial.js` для создания ролей и админа.
- [ ] Пароль админа сменён после первого входа.

После этого проект будет доступен онлайн, а разработку можно продолжать локально и выкатывать изменения через Git или повторный деплой.
