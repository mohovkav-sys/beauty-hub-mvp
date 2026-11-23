// Импортируем React и нужные хуки: useState (состояние), useEffect (побочные эффекты), useCallback (мемоизация функций)
import React, { useState, useEffect, useCallback } from 'react';
// Импортируем настроенный клиент Supabase для обращения к базе данных
import { supabase } from './lib/supabase';
// Импортируем ui-kit стили
import './styles/ui-kit.css';
// Импортируем компонент входа/регистрации пользователя
import Auth from './components/Auth';
// Импортируем стартовый экран мастера с 4 квадратными блоками и заглушку страницы «Отчет»
import DashboardHome, { ReportStubPage } from './components/DashboardHome';
// Импортируем стартовый экран клиента с 4 блоками и плашкой-напоминанием
import ClientDashboardHome from './components/ClientDashboardHome';
// Импортируем компоненты управления услугами и расписанием мастера
import MasterServices from './components/MasterServices';
import MasterSchedule from './components/MasterSchedule';
// Импортируем компоненты записи и просмотра записей для клиента
import ClientBooking from './components/ClientBooking';
import ClientBookingsList from './components/ClientBookingsList';
// Подключаем стили приложения
import './App.css';

// Имя ключа, под которым сохраняем данные авторизованного пользователя в localStorage браузера
const SESSION_STORAGE_KEY = 'beauty_hub_current_user_v1';

/**
 * Читает сохранённый объект пользователя из localStorage.
 * Возвращает объект пользователя или null, если данных нет или JSON повреждён.
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
 * Сохраняет профиль пользователя в localStorage или удаляет его, если передан null.
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
 * Управляет сессией пользователя, верхней панелью и отображением экранов входа, кабинета мастера и кабинета клиента.
 */
export default function App() {
  // Состояние текущего пользователя; ленивая инициализация читает localStorage только при первом рендере
  const [currentUser, setCurrentUser] = useState(() => readStoredUser());
  // Счётчик для принудительного обновления списка записей и напоминания клиента после создания новой записи
  const [bookingsRefreshKey, setBookingsRefreshKey] = useState(0);
  // Активный подраздел внутри кабинета мастера ('home' | 'price' | 'calendar' | 'bookings' | 'report')
  const [activePage, setActivePage] = useState('home');
  // Активный подраздел внутри кабинета клиента ('home' | 'book' | 'archive' | 'about' | 'settings')
  const [clientPage, setClientPage] = useState('home');

  /**
   * Запрашивает актуальный профиль пользователя из таблицы users в Supabase по его id
   * и синхронизирует состояние React и localStorage.
   */
  const syncStoredUserFromDb = useCallback(async (userId) => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, phone, full_name, role')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        setCurrentUser(data);
        writeStoredUser(data);
      }
    } catch (err) {
      console.warn('Не удалось освежить профиль пользователя из БД:', err);
    }
  }, []);

  // Эффект запускается при монтировании и при изменении currentUser?.id для актуализации профиля из БД
  useEffect(() => {
    if (currentUser?.id) {
      syncStoredUserFromDb(currentUser.id);
    }
  }, [currentUser?.id, syncStoredUserFromDb]);

  /**
   * Обработчик успешного входа или регистрации.
   */
  const handleAuthSuccess = (user) => {
    setCurrentUser(user);
    writeStoredUser(user);
    setActivePage('home');
    setClientPage('home');
  };

  /**
   * Обработчик выхода из аккаунта.
   */
  const handleLogout = () => {
    setCurrentUser(null);
    setActivePage('home');
    setClientPage('home');
    writeStoredUser(null);
  };

  /**
   * Возвращает JSX выбранного раздела для кабинета мастера.
   */
  const renderMasterContent = () => {
    if (activePage === 'report') {
      return <ReportStubPage onBack={() => setActivePage('home')} />;
    }

    if (activePage === 'price') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white px-6 py-4 rounded-2xl shadow-sm border border-beauty-light">
            <h2 className="text-xl font-bold text-beauty-dark">Прайс и услуги</h2>
            <button
              type="button"
              onClick={() => setActivePage('home')}
              className="border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              ← На главную кабинета
            </button>
          </div>
          <MasterServices master={currentUser} />
        </div>
      );
    }

    if (activePage === 'calendar') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white px-6 py-4 rounded-2xl shadow-sm border border-beauty-light">
            <h2 className="text-xl font-bold text-beauty-dark">Календарь и график</h2>
            <button
              type="button"
              onClick={() => setActivePage('home')}
              className="border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              ← На главную кабинета
            </button>
          </div>
          <MasterSchedule master={currentUser} />
        </div>
      );
    }

    if (activePage === 'bookings') {
      return (
        <section className="bg-white p-6 sm:p-8 rounded-2xl shadow-md border border-beauty-light text-left space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-beauty-dark">Записи клиентов</h2>
              <p className="text-sm text-gray-600 mt-1">
                Раздел управления записями мастера.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActivePage('home')}
              className="border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              ← На главную кабинета
            </button>
          </div>
          <p className="text-sm text-slate-600">
            Здесь отображаются записи клиентов мастера. При необходимости можно связать список записей из таблицы <code>bookings</code> по <code>master_id</code>.
          </p>
        </section>
      );
    }

    return (
      <DashboardHome
        title={`Добро пожаловать, ${currentUser.full_name}`}
        subtitle="Выберите раздел для работы"
        onNavigate={(pageId) => setActivePage(pageId)}
      />
    );
  };

  /**
   * Возвращает JSX выбранного раздела для кабинета клиента:
   * стартовый экран с 4 блоками и плашкой-напоминанием ('home') либо один из разделов.
   */
  const renderClientContent = () => {
    if (clientPage === 'book') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white px-6 py-4 rounded-2xl shadow-sm border border-beauty-light">
            <h2 className="text-xl font-bold text-beauty-dark">Записаться</h2>
            <button
              type="button"
              onClick={() => setClientPage('home')}
              className="border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              ← На главную кабинета
            </button>
          </div>
          <ClientBooking
            client={currentUser}
            onBookingCreated={() => setBookingsRefreshKey((prev) => prev + 1)}
          />
        </div>
      );
    }

    if (clientPage === 'archive') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white px-6 py-4 rounded-2xl shadow-sm border border-beauty-light">
            <h2 className="text-xl font-bold text-beauty-dark">Архив записей</h2>
            <button
              type="button"
              onClick={() => setClientPage('home')}
              className="border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              ← На главную кабинета
            </button>
          </div>
          <ClientBookingsList
            client={currentUser}
            refreshKey={bookingsRefreshKey}
          />
        </div>
      );
    }

    if (clientPage === 'about') {
      return (
        <section className="bg-white p-6 sm:p-8 rounded-2xl shadow-md border border-beauty-light text-left space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-beauty-dark">О нас</h2>
            <button
              type="button"
              onClick={() => setClientPage('home')}
              className="border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              ← На главную кабинета
            </button>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Beauty Hub — сервис онлайн-записи к проверенным мастерам. Выбирайте услугу,
            удобную дату и свободное время без звонков и ожидания.
          </p>
        </section>
      );
    }

    if (clientPage === 'settings') {
      return (
        <section className="bg-white p-6 sm:p-8 rounded-2xl shadow-md border border-beauty-light text-left space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-beauty-dark">Настройки</h2>
            <button
              type="button"
              onClick={() => setClientPage('home')}
              className="border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              ← На главную кабинета
            </button>
          </div>
          <div className="text-sm text-slate-700 space-y-1">
            <p><span className="font-semibold">Имя:</span> {currentUser.full_name}</p>
            <p><span className="font-semibold">Телефон:</span> {currentUser.phone}</p>
            <p><span className="font-semibold">Роль:</span> Клиент</p>
          </div>
        </section>
      );
    }

    return (
      <ClientDashboardHome
        client={currentUser}
        refreshKey={bookingsRefreshKey}
        onNavigate={(pageId) => setClientPage(pageId)}
      />
    );
  };

  /**
   * Возвращает на главную страницу текущего кабинета в зависимости от роли пользователя.
   */
  const handleGoHome = () => {
    if (currentUser?.role === 'master') {
      setActivePage('home');
    } else if (currentUser?.role === 'client') {
      setClientPage('home');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between">
      {/* Единый контейнер кабинета: шапка и основная область слиты без зазора */}
      <div className="w-full max-w-5xl mx-auto my-4 sm:my-6 flex-1 flex flex-col rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-white">
        {/* Верхняя панель приложения */}
        <header className="app-header w-full bg-white text-slate-900 border-b border-slate-200 px-6 py-4 flex flex-wrap gap-4 justify-between items-center">
          <div
            role={currentUser ? 'button' : undefined}
            tabIndex={currentUser ? 0 : undefined}
            onClick={handleGoHome}
            onKeyDown={(e) => {
              if (currentUser && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                handleGoHome();
              }
            }}
            className={`flex items-center gap-3 ${
              currentUser ? 'cursor-pointer select-none' : ''
            }`}
            title={currentUser ? 'На главную кабинета' : undefined}
          >
            <h1 className="text-xl sm:text-2xl font-bold tracking-wider text-slate-900">
              BEAUTY HUB
            </h1>
            <span className="text-xs sm:text-sm bg-slate-100 text-slate-800 border border-slate-200 px-3 py-1 rounded-full font-semibold">
              MVP v1.0
            </span>
          </div>

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

        {/* Основная рабочая область — вплотную к шапке */}
        <main className="w-full flex-1 flex flex-col justify-center p-4 sm:p-6">
          {!currentUser ? (
            <Auth onAuthSuccess={handleAuthSuccess} />
          ) : currentUser.role === 'master' ? (
            renderMasterContent()
          ) : (
            renderClientContent()
          )}
        </main>
      </div>

      {/* Нижний колонтитул приложения */}
      <footer className="w-full max-w-5xl mx-auto text-center text-sm text-gray-500 py-2">
        Beauty Hub • Все услуги в одном месте
      </footer>
    </div>
  );
}