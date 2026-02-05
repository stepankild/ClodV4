# Farm Portal

Веб-портал для управления фермой с системой авторизации и управления пользователями.

## Технологии

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend**: Node.js + Express.js
- **База данных**: MongoDB
- **Авторизация**: JWT (access + refresh tokens)
- **Права доступа**: RBAC (Role-Based Access Control)

## Быстрый старт

### 1. Запуск MongoDB

```bash
docker-compose up -d
```

### 2. Настройка Backend

```bash
cd server
npm install
npm run seed    # Создание начальных данных (роли, админ)
npm run dev     # Запуск сервера разработки
```

### 3. Настройка Frontend

```bash
cd client
npm install
npm run dev     # Запуск клиента разработки
```

### 4. Открыть приложение

Перейдите на http://localhost:5173

**Данные для входа:**
- Email: `admin@farm.com`
- Пароль: `admin123`

## Структура проекта

```
ClodV4/
├── client/                 # React Frontend
│   ├── src/
│   │   ├── components/     # Переиспользуемые компоненты
│   │   ├── context/        # React Context (AuthContext)
│   │   ├── pages/          # Страницы
│   │   └── services/       # API сервисы
│   └── ...
├── server/                 # Node.js Backend
│   ├── config/             # Конфигурация (БД)
│   ├── controllers/        # Контроллеры
│   ├── middleware/         # Middleware (auth, rbac)
│   ├── models/             # Mongoose модели
│   ├── routes/             # Маршруты API
│   ├── seeds/              # Начальные данные
│   └── utils/              # Утилиты (JWT)
├── docker-compose.yml      # MongoDB контейнер
└── README.md
```

## API Endpoints

### Авторизация
- `POST /api/auth/login` - Вход в систему
- `POST /api/auth/refresh` - Обновление токена
- `POST /api/auth/logout` - Выход
- `GET /api/auth/me` - Текущий пользователь

### Пользователи
- `GET /api/users` - Список пользователей
- `GET /api/users/:id` - Получить пользователя
- `POST /api/users` - Создать пользователя
- `PUT /api/users/:id` - Обновить пользователя
- `DELETE /api/users/:id` - Удалить пользователя
- `GET /api/users/roles` - Список ролей

## Система прав (RBAC)

### Предустановленные роли:
- **SuperAdmin** - Полный доступ ко всей системе (*)
- **Admin** - Управление пользователями, доступ к дашборду
- **User** - Базовый доступ к дашборду

### Разрешения:
- `*` - Суперадминские права (все разрешения)
- `users:read` - Просмотр пользователей
- `users:create` - Создание пользователей
- `users:update` - Редактирование пользователей
- `users:delete` - Удаление пользователей
- `dashboard:view` - Просмотр дашборда

## Следующие шаги

Портал готов для расширения. Планируемые модули:
- Управление животными
- Учёт продукции
- Складской учёт
- Задачи и календарь
- Отчёты и аналитика
