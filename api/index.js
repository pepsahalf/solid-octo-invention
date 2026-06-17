const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
app.use(express.json({ limit: '10mb' })); 
app.use(cors());

// Токен вашего бота и адрес базы данных
const BOT_TOKEN = process.env.BOT_TOKEN || '8709224223:AAGU74o3Wh1oHFdAK24cpXQwiGO725_S4aM';
const MONGODB_URI = process.env.MONGODB_URI;

let isDbConnected = false;

// Генератор случайных безопасных токенов сессий
function generateSessionToken() {
    return crypto.randomBytes(16).toString('hex');
}

// Локальное хранилище данных (резерв на случай отсутствия MongoDB)
let localDb = {
    cats: ['Главная', 'Архив', 'Ритуалы', 'Существа', 'История', 'Рассказы', 'Термины', 'Артефакты'],
    availableTags: ['сущность', 'аномалия', 'растение', 'опасность', 'локация', 'ритуал', 'еда', 'животное', 'люди', 'Fonés', 'Кораст'],
    arts: [
        { 
            id: 1700000000000, 
            title: 'Главный зал сарктиса', 
            cat: 'Ритуалы', 
            cover: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=800', 
            content: '<p>Древний зал, где проходят основные таинства вознесения и очищения...</p>', 
            author: 'admin', 
            status: 'published', 
            tags: ['локация', 'ритуал'], 
            voters: {}, 
            isFeatured: true 
        }
    ],
    heart: { hp: 98.7, act: 'Высокая', size: 8 },
    rules: '<h1>Правила сообщества</h1><p>1. Уважайте структуру генофонда.<br>2. Все созидаемые статьи подлежат обязательной цензуре суперадмина.</p>',
    users: [
        { id: 1, name: 'admin', pass: 'admin', role: 'admin', allowedCategory: '*', sessionToken: 'admin_test_session_token' }
    ]
};

// Схемы данных Mongoose для базы данных
const UserSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    name: String,
    pass: String,
    role: String,
    allowedCategory: String,
    sessionToken: String // Хранилище сессии без передачи пароля
});

const ArticleSchema = new mongoose.Schema({
    id: Number,
    title: String,
    cat: String,
    cover: String,
    content: String,
    author: String,
    status: String,
    tags: [String],
    voters: { type: Map, of: Number, default: {} },
    isFeatured: { type: Boolean, default: false }
});

const SystemStateSchema = new mongoose.Schema({
    key: { type: String, default: 'main_state' },
    cats: [String],
    availableTags: [String],
    heart: {
        hp: Number,
        act: String,
        size: Number
    },
    rules: String
});

const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
const ArticleModel = mongoose.models.Article || mongoose.model('Article', ArticleSchema);
const SystemStateModel = mongoose.models.SystemState || mongoose.model('SystemState', SystemStateSchema);

// Автоматический сидинг (создание дефолтного админа при пустой базе)
async function seedAdmin() {
    try {
        const adminCount = await UserModel.countDocuments({ role: 'admin' });
        if (adminCount === 0) {
            await UserModel.create({
                id: 1,
                name: 'admin',
                pass: 'admin',
                role: 'admin',
                allowedCategory: '*',
                sessionToken: generateSessionToken()
            });
            console.log('Дефолтный суперадмин успешно создан (логин: admin, пароль: admin)');
        }
    } catch (e) {
        console.error('Ошибка создания дефолтного админа:', e);
    }
}

// Подключение к внешней базе данных MongoDB
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(async () => {
            isDbConnected = true;
            console.log('Успешное подключение к MongoDB');
            await seedAdmin(); // Инициализируем создание админа
        })
        .catch(err => {
            console.error('Ошибка подключения к MongoDB:', err);
        });
}

// Получение общих настроек системы
async function getSystemState() {
    if (isDbConnected) {
        let state = await SystemStateModel.findOne({ key: 'main_state' });
        if (!state) {
            state = await SystemStateModel.create({
                key: 'main_state',
                cats: localDb.cats,
                availableTags: localDb.availableTags,
                heart: localDb.heart,
                rules: localDb.rules
            });
        }
        return state;
    }
    return localDb;
}

// Проверка сессии по уникальному токену
async function verifySession(sessionToken) {
    if (!sessionToken) return null;
    if (isDbConnected) {
        return await UserModel.findOne({ sessionToken });
    }
    return localDb.users.find(u => u.sessionToken === sessionToken);
}

// =========================================================================
// МАРШРУТЫ КЛИЕНТСКОЙ ЧАСТИ
// =========================================================================

// Запрос основных данных для сайта
app.get('/api/data', async (req, res) => {
    try {
        const state = await getSystemState();
        let arts = [];
        
        if (isDbConnected) {
            arts = await ArticleModel.find({ status: 'published' }).lean();
        } else {
            arts = localDb.arts.filter(a => a.status === 'published');
        }

        res.json({
            cats: state.cats,
            availableTags: state.availableTags,
            arts: arts,
            heart: state.heart,
            rules: state.rules
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера: ' + e.message });
    }
});

// Классическая авторизация по логину и паролю
app.post('/api/login', async (req, res) => {
    try {
        const { name, pass } = req.body;
        let user = null;

        if (isDbConnected) {
            user = await UserModel.findOne({ name, pass });
            if (user) {
                user.sessionToken = generateSessionToken();
                await user.save();
            }
        } else {
            user = localDb.users.find(u => u.name === name && u.pass === pass);
            if (user) {
                user.sessionToken = generateSessionToken();
            }
        }

        if (user) {
            res.json({ success: true, user });
        } else {
            res.status(401).json({ success: false, error: 'Неверные имя пользователя или пароль.' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Авторизация через Telegram Login Widget
app.post('/api/login-tg', async (req, res) => {
    try {
        const authData = req.body;
        const isValid = verifyTelegramHash(authData, BOT_TOKEN);

        if (!isValid) {
            return res.status(401).json({ success: false, error: 'Ошибка верификации подписи.' });
        }

        const now = Math.floor(Date.now() / 1000);
        if (now - parseInt(authData.auth_date) > 86400) {
            return res.status(401).json({ success: false, error: 'Время авторизации истекло.' });
        }

        const tgId = authData.id;
        const username = authData.username || authData.first_name || `user_${tgId}`;
        const newSessionToken = generateSessionToken();

        let user;
        if (isDbConnected) {
            user = await UserModel.findOne({ id: tgId });
            if (!user) {
                user = await UserModel.create({
                    id: tgId,
                    name: username,
                    pass: Math.random().toString(36).substring(2, 8),
                    role: 'reader',
                    allowedCategory: '*',
                    sessionToken: newSessionToken
                });
            } else {
                user.sessionToken = newSessionToken;
                await user.save();
            }
        } else {
            user = localDb.users.find(u => u.id === tgId);
            if (!user) {
                user = {
                    id: tgId,
                    name: username,
                    pass: Math.random().toString(36).substring(2, 8),
                    role: 'reader',
                    allowedCategory: '*',
                    sessionToken: newSessionToken
                };
                localDb.users.push(user);
            } else {
                user.sessionToken = newSessionToken;
            }
        }

        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка авторизации Telegram: ' + e.message });
    }
});

// Добавление новой статьи или её обновление
app.post('/api/articles', async (req, res) => {
    try {
        const { sessionToken, id, title, cat, cover, content, isFeatured, tags } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || (user.role !== 'admin' && user.role !== 'author')) {
            return res.status(403).json({ error: 'Недостаточно прав для выполнения операции.' });
        }

        if (user.role === 'author' && user.allowedCategory !== '*' && user.allowedCategory !== cat) {
            return res.status(403).json({ error: 'Вам запрещено публиковать статьи в выбранную категорию.' });
        }

        const articleId = id ? parseInt(id) : Date.now();
        const status = user.role === 'admin' ? 'published' : 'pending';

        const articleData = {
            id: articleId,
            title,
            cat,
            cover,
            content,
            author: user.name,
            status,
            tags,
            isFeatured: user.role === 'admin' ? !!isFeatured : false
        };

        if (isDbConnected) {
            if (id) {
                const existing = await ArticleModel.findOne({ id: articleId });
                if (existing) {
                    articleData.voters = existing.voters;
                    articleData.status = user.role === 'admin' ? existing.status : 'pending';
                }
                await ArticleModel.findOneAndUpdate({ id: articleId }, articleData);
            } else {
                await ArticleModel.create(articleData);
            }
        } else {
            if (id) {
                const idx = localDb.arts.findIndex(a => a.id === articleId);
                if (idx !== -1) {
                    articleData.voters = localDb.arts[idx].voters || {};
                    articleData.status = user.role === 'admin' ? localDb.arts[idx].status : 'pending';
                    localDb.arts[idx] = articleData;
                }
            } else {
                articleData.voters = {};
                localDb.arts.push(articleData);
            }
        }

        res.json({ success: true, status });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Оценка (голосование) статьи звездами
app.post('/api/articles/rate', async (req, res) => {
    try {
        const { id, voterId, val } = req.body;
        const score = parseInt(val);

        if (score < 1 || score > 5) {
            return res.status(400).json({ error: 'Некорректное значение оценки.' });
        }

        if (isDbConnected) {
            const art = await ArticleModel.findOne({ id: parseInt(id) });
            if (art) {
                art.voters = art.voters || new Map();
                art.voters.set(voterId.toString(), score);
                art.markModified('voters');
                await art.save();
            }
        } else {
            const art = localDb.arts.find(a => a.id === parseInt(id));
            if (art) {
                art.voters = art.voters || {};
                art.voters[voterId] = score;
            }
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =========================================================================
// АДМИНИСТРАТИВНЫЕ МАРШРУТЫ (ТРЕБУЕТСЯ РОЛЬ ADMIN)
// =========================================================================

// Запрос полного списка данных для админ-панели
app.post('/api/admin/data', async (req, res) => {
    try {
        const { sessionToken } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен.' });
        }

        const state = await getSystemState();
        let allArts = [];
        let allUsers = [];

        if (isDbConnected) {
            allArts = await ArticleModel.find({}).lean();
            allUsers = await UserModel.find({}).lean();
        } else {
            allArts = localDb.arts;
            allUsers = localDb.users;
        }

        res.json({
            arts: allArts,
            cats: state.cats,
            availableTags: state.availableTags,
            heart: state.heart,
            users: allUsers
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Одобрение статьи (публикация) или отклонение
app.post('/api/articles/moderate', async (req, res) => {
    try {
        const { sessionToken, id, status } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен.' });
        }

        if (isDbConnected) {
            if (status === 'rejected') {
                await ArticleModel.deleteOne({ id: parseInt(id) });
            } else {
                await ArticleModel.findOneAndUpdate({ id: parseInt(id) }, { status: 'published' });
            }
        } else {
            if (status === 'rejected') {
                localDb.arts = localDb.arts.filter(a => a.id !== parseInt(id));
            } else {
                const art = localDb.arts.find(a => a.id === parseInt(id));
                if (art) art.status = 'published';
            }
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Сохранение отредактированных правил сообщества
app.post('/api/rules', async (req, res) => {
    try {
        const { sessionToken, rules } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен.' });
        }

        if (isDbConnected) {
            await SystemStateModel.findOneAndUpdate({ key: 'main_state' }, { rules });
        } else {
            localDb.rules = rules;
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Создание или обновление учетных записей пользователей
app.post('/api/users/save', async (req, res) => {
    try {
        const { sessionToken, targetUserId, name, userPass, role, allowedCategory } = req.body;
        const admin = await verifySession(sessionToken);

        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен.' });
        }

        const userId = targetUserId ? parseInt(targetUserId) : Date.now();
        const userData = {
            id: userId,
            name,
            pass: userPass,
            role,
            allowedCategory: role === 'author' ? allowedCategory : '*'
        };

        if (isDbConnected) {
            if (targetUserId) {
                await UserModel.findOneAndUpdate({ id: userId }, userData);
            } else {
                userData.sessionToken = generateSessionToken();
                await UserModel.create(userData);
            }
        } else {
            if (targetUserId) {
                const idx = localDb.users.findIndex(u => u.id === userId);
                if (idx !== -1) localDb.users[idx] = userData;
            } else {
                userData.sessionToken = generateSessionToken();
                localDb.users.push(userData);
            }
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Удаление аккаунта пользователя
app.post('/api/users/delete', async (req, res) => {
    try {
        const { sessionToken, targetUserId } = req.body;
        const admin = await verifySession(sessionToken);

        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен.' });
        }

        if (parseInt(targetUserId) === admin.id) {
            return res.status(400).json({ error: 'Вы не можете удалить свой собственный аккаунт.' });
        }

        if (isDbConnected) {
            await UserModel.deleteOne({ id: parseInt(targetUserId) });
        } else {
            localDb.users = localDb.users.filter(u => u.id !== parseInt(targetUserId));
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Добавление новой категории
app.post('/api/cats/add', async (req, res) => {
    try {
        const { sessionToken, catName } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещен.' });

        const state = await getSystemState();
        if (!state.cats.includes(catName)) {
            state.cats.push(catName);
            if (isDbConnected) {
                await SystemStateModel.findOneAndUpdate({ key: 'main_state' }, { cats: state.cats });
            }
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Удаление категории
app.post('/api/cats/delete', async (req, res) => {
    try {
        const { sessionToken, catName } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещен.' });
        if (catName === 'Главная') return res.status(400).json({ error: 'Категория "Главная" не может быть удалена.' });

        const state = await getSystemState();
        state.cats = state.cats.filter(c => c !== catName);

        if (isDbConnected) {
            await SystemStateModel.findOneAndUpdate({ key: 'main_state' }, { cats: state.cats });
            await ArticleModel.updateMany({ cat: catName }, { cat: 'Архив' });
        } else {
            localDb.cats = state.cats;
            localDb.arts.forEach(a => { if (a.cat === catName) a.cat = 'Архив'; });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Добавление нового тега
app.post('/api/tags/add', async (req, res) => {
    try {
        const { sessionToken, tagName } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещен.' });

        const state = await getSystemState();
        const formattedTag = tagName.toLowerCase().trim();

        if (!state.availableTags.includes(formattedTag)) {
            state.availableTags.push(formattedTag);
            if (isDbConnected) {
                await SystemStateModel.findOneAndUpdate({ key: 'main_state' }, { availableTags: state.availableTags });
            }
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Удаление тега из системы
app.post('/api/tags/delete', async (req, res) => {
    try {
        const { sessionToken, tagName } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещен.' });

        const state = await getSystemState();
        state.availableTags = state.availableTags.filter(t => t !== tagName);

        if (isDbConnected) {
            await SystemStateModel.findOneAndUpdate({ key: 'main_state' }, { availableTags: state.availableTags });
            await ArticleModel.updateMany({}, { $pull: { tags: tagName } });
        } else {
            localDb.availableTags = state.availableTags;
            localDb.arts.forEach(a => {
                if (a.tags) a.tags = a.tags.filter(t => t !== tagName);
            });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Изменение показателей "Состояния сердца"
app.post('/api/heart/save', async (req, res) => {
    try {
        const { sessionToken, hp, act, size } = req.body;
        const user = await verifySession(sessionToken);

        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен.' });
        }

        const heartData = {
            hp: parseFloat(hp),
            act,
            size: parseInt(size)
        };

        if (isDbConnected) {
            await SystemStateModel.findOneAndUpdate({ key: 'main_state' }, { heart: heartData });
        } else {
            localDb.heart = heartData;
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Запуск сервера в локальной Node-среде (вне Vercel)
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
    });
}

module.exports = app;
