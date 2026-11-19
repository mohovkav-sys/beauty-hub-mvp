import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';
import Auth from './components/Auth';
import MasterServices from './components/MasterServices';
import MasterSchedule from './components/MasterSchedule';
import ClientBooking from './components/ClientBooking';
import './App.css';

// Ключ для хранения сессии авторизованного пользователя в браузере
const SESSION_STORAGE_KEY = 'beauty_hub_current_user_v1';

/**
 * Безопасно читает сохранённый профиль пользователя из localStorage.
 * Возвращает объект пользователя или null, если сессии нет / данные повреждены.
 *
 * @returns {Object|null}
 */
function readStoredUser() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.id) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('Не удалось прочитать сессию из localStorage:', err);
    return null;
  }
}

/**
 * Безопасно сохраняет профиль пользователя в localStorage или удаляет его при значении null.
 *
 * @param {Object|null} user
 */
function writeStoredUser(user) {
  try {
    if (!user) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
  } catch (err) {
    console.warn('Не удалось обновить сессию в localStorage:', err);
  }
}

/**
 * Главный компонент приложения «Beauty Hub».
 * Хранит сессию пользователя в браузере (localStorage) и переключает между экраном входа,
 * кабинетом клиента и кабинетом мастера.
 */
export default function App() {
  // Инициализируем состояние пользователя сразу из localStorage, чтобы при обновлении страницы не вылетало окно входа
  const [currentUser, setCurrentUser] = useState(() => readStoredUser());

  /**
   * Синхронизирует профиль пользователя с таблицей `users` в Supabase,
   * если в браузере уже была сохранена сессия.
   */
  const syncStoredUserFromDb = useCallback(async (userId) => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, phone, full_name, role')
        .eq('id', userId)
        .maybeSingle();

      // Не сбрасываем сессию при временных сетевых ошибках; обновляем только при успешном ответе
      if (!error && data) {
        setCurrentUser(data);
        writeStoredUser(data);
      }
    } catch (err) {
      console.warn('Не удалось освежить профиль пользователя из БД:', err);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      syncStoredUserFromDb(currentUser.id);
    }
  }, [currentUser?.id, syncStoredUserFromDb]);

  /**
   * Обработчик успешной авторизации или регистрации.
   * Сохраняет профиль в React-состоянии и в localStorage.
   *
   * @param {Object} user - Профиль пользователя (id, phone, full_name, role)
   */
  const handleAuthSuccess = (user) => {
    setCurrentUser(user);
    writeStoredUser(user);
  };

  /**
   * Обработчик выхода из аккаунта.
   * Очищает состояние и удаляет сессию из localStorage.
   */
  const handleLogout = () => {
    setCurrentUser(null);
    writeStoredUser(null);
  };

  return (
    <div className="min-h-screen bg-beauty-light flex flex-col justify-between p-4">
      {/* Верхняя панель приложения с брендингом и статусом сессии */}
      <header className="app-header w-full max-w-5xl mx-auto bg-white text-slate-900 border border-slate-200 px-6 py-4 rounded-2xl shadow-lg flex flex-wrap gap-4 justify-between items-center">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold tracking-wider text-slate-900">
            BEAUTY HUB
          </h1>
          <span className="text-xs sm:text-sm bg-slate-100 text-slate-800 border border-slate-200 px-3 py-1 rounded-full font-semibold">
            MVP v1.0
          </span>
        </div>

        {/* Если пользователь вошёл — показываем его имя, роль и кнопку выхода */}
        {currentUser && (
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              <p className="font-semibold">{currentUser.full_name}</p>
              <p className="text-xs text-slate-600">
                {currentUser.role === 'master' ? 'Кабинет мастера' : 'Кабинет клиента'} •{' '}
                {currentUser.phone}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              Выйти
            </button>
          </div>
        )}
      </header>

      {/* Основная рабочая область приложения */}
      <main className="w-full max-w-5xl mx-auto my-8 flex-1 flex flex-col justify-center">
        {/* ВЕТКА 1: Пользователь не авторизован — показываем форму входа */}
        {!currentUser ? (
          <Auth onAuthSuccess={handleAuthSuccess} />
        ) : currentUser.role === 'master' ? (
          /* ВЕТКА 2: Авторизован мастер — приветствие, услуги и расписание */
          <div className="space-y-6">
            <section className="bg-white p-6 sm:p-8 rounded-2xl shadow-md border border-beauty-light text-left">
              <h2 className="text-2xl font-bold text-beauty-dark mb-2">
                Добро пожаловать, {currentUser.full_name}
              </h2>
              <p className="text-gray-600">
                Управляйте услугами и рабочими днями в расписании ниже.
              </p>
            </section>
            <MasterServices master={currentUser} />
            <MasterSchedule master={currentUser} />
          </div>
        ) : (
          /* ВЕТКА 3: Авторизован клиент — приветствие и запись к мастеру */
          <div className="space-y-6">
            <section className="bg-white p-6 sm:p-8 rounded-2xl shadow-md border border-beauty-light text-left">
              <h2 className="text-2xl font-bold text-beauty-dark mb-2">
                Добро пожаловать, {currentUser.full_name}
              </h2>
              <p className="text-gray-600">
                Выберите услугу, мастера, дату и свободное время для записи.
              </p>
            </section>
            <ClientBooking client={currentUser} />
          </div>
        )}
      </main>

      {/* Нижний колонтитул */}
      <footer className="w-full max-w-5xl mx-auto text-center text-sm text-gray-500 py-2">
        Beauty Hub • Клиентский и мастерский кабинеты
      </footer>
    </div>
  );
}