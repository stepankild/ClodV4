# Оптимальный путь: разработка в Cursor → изменения сразу онлайн

Цепочка: **Cursor (локально)** → **GitHub** → **Railway** (автодеплой при каждом push). База: **MongoDB Atlas**.

---

## Шаг 1. GitHub (хранилище кода и триггер деплоя)

1. Зайдите на **[github.com](https://github.com)** и войдите или зарегистрируйтесь.
2. Нажмите **"+"** → **New repository**.
3. Название, например: **ClodV4** (или farm-portal).  
   **Create repository** (без README, без .gitignore — они уже в проекте).
4. В Cursor откройте терминал в корне проекта и выполните:

   ```bash
   git init
   git add .
   git commit -m "Initial: Farm Portal"
   git branch -M main
   git remote add origin https://github.com/ВАШ_ЛОГИН/ClodV4.git
   git push -u origin main
   ```

   Вместо `ВАШ_ЛОГИН` — ваш логин на GitHub. Если спросит пароль — используйте **Personal Access Token** (GitHub → Settings → Developer settings → Personal access tokens → Generate new token).

После этого весь код будет в GitHub, и вы сможете подключать к репозиторию хостинг.

---

## Шаг 2. MongoDB Atlas (база в облаке)

1. Зайдите на **[mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)** и зарегистрируйтесь (или войдите).
2. **Build a Database** → выберите бесплатный план **M0** → регион ближе к вам → **Create**.
3. Создайте пользователя БД:
   - **Database Access** → **Add New Database User**  
   - Логин и пароль (сохраните их).  
   - **Add User**.
4. Разрешите доступ с любого IP (для Railway):
   - **Network Access** → **Add IP Address**  
   - **Allow Access from Anywhere** (0.0.0.0/0) → **Confirm**.
5. Получите строку подключения:
   - **Database** → **Connect** → **Drivers** → скопируйте строку вида:
     ```text
     mongodb+srv://USERNAME:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
     ```
   - Вставьте в неё **свой пароль** вместо `<password>` и в конец добавьте имя базы: `/farm_portal` перед `?`:
     ```text
     mongodb+srv://USERNAME:ВАШ_ПАРОЛЬ@cluster0.xxxxx.mongodb.net/farm_portal?retryWrites=true&w=majority
     ```
   - Эту строку целиком сохраните — она понадобится как **MONGODB_URI** на Railway.

---

## Шаг 3. Railway (хостинг приложения, автодеплой из GitHub)

1. Зайдите на **[railway.app](https://railway.app)** и войдите через **GitHub** (Login with GitHub).
2. **New Project** → **Deploy from GitHub repo**.
3. Выберите репозиторий **ClodV4** (или как назвали). Если его нет в списке — **Configure GitHub App** и дайте Railway доступ к нужному репо.
4. Railway создаст сервис. Откройте его → вкладка **Variables**.
5. Добавьте переменные (кнопка **+ New Variable** или **Raw Editor**):

   | Переменная           | Значение |
   |----------------------|----------|
   | `NODE_ENV`           | `production` |
   | `MONGODB_URI`        | ваша строка из шага 2 (целиком) |
   | `JWT_SECRET`         | придумайте длинную строку (например 20+ случайных символов) |
   | `JWT_REFRESH_SECRET` | другая длинная строка |
   | `CLIENT_URL`         | пока оставьте пустым или `https://ваш-проект.up.railway.app` — подставим после первого деплоя |

6. Настройки сборки и запуска:
   - Вкладка **Settings** у сервиса.
   - **Root Directory:** оставьте пустым (корень репо).
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run start`
   - **Watch Paths:** можно не трогать (деплой при любом push).

7. Сохраните и дождитесь окончания деплоя (Deployments → смотреть лог).
8. После успешного деплоя: **Settings** → **Networking** → **Generate Domain**. Скопируйте URL (например `https://clodv4-production.up.railway.app`).
9. Вернитесь в **Variables** и задайте:
   - `CLIENT_URL` = этот URL (без слэша в конце).

10. Один раз заполните базу (роли, админ):
    - В Railway: ваш сервис → **Settings** → внизу **One-off command** или откройте **Deployments** → последний деплой → три точки → **Run command** (если есть).
    - Либо в терминале Cursor (подключение к той же MongoDB Atlas) из корня проекта:
      ```bash
      cd server
      set MONGODB_URI=ваша_строка_подключения
      node seeds/initial.js
      ```
    Логин админа по умолчанию: **admin@farm.com** / **admin123** — смените пароль после первого входа в онлайн-версию.

Готово: приложение доступно по выданному Railway URL.

---

## Как дальше работать в Cursor и применять изменения онлайн

1. Разработка в Cursor как обычно (меняете код в `client` и/или `server`).
2. Когда хотите выкатить изменения в интернет:
   - В терминале в **корне проекта**:
     ```bash
     git add .
     git commit -m "Описание изменений"
     git push
     ```
3. Railway сам подхватит push, заново выполнит `npm run build` и `npm run start`. Через 1–2 минуты новая версия будет онлайн.

Дополнительно:
- Локально для разработки: в одном терминале `cd server && npm run dev`, в другом `cd client && npm run dev`. В `server/.env` можно использовать тот же MongoDB Atlas с другой базой (например `farm_portal_dev`) или локальный MongoDB.
- История правок и откаты — в GitHub (и в Cursor через Git).

---

## Краткий чеклист

- [ ] **GitHub:** аккаунт, репозиторий создан, проект запушен (`git init`, `add`, `commit`, `remote`, `push`).
- [ ] **MongoDB Atlas:** кластер M0, пользователь БД, доступ 0.0.0.0/0, строка подключения с паролем и `/farm_portal` сохранена.
- [ ] **Railway:** вход через GitHub, проект из репо ClodV4, переменные (NODE_ENV, MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET, CLIENT_URL), Build: `npm run build`, Start: `npm run start`, сгенерирован домен, CLIENT_URL обновлён.
- [ ] **Сид:** выполнен `node seeds/initial.js` (локально с MONGODB_URI или через Railway, если есть команда).
- [ ] Пароль админа сменён после первого входа на прод-сайте.

После этого вы продолжаете разрабатывать в Cursor, а все изменения применяются онлайн простым `git push`.
