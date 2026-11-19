import React, { useState } from 'react';
import Auth from './components/Auth';
import MasterServices from './components/MasterServices';
/**
 * Главный компонент приложения «Beauty Hub».
 * Управляет состоянием текущего пользователя и переключает между экраном входа,
 * кабинетом клиента и кабинетом мастера.
 */
export default function App() {
  // Храним данные авторизованного пользователя (null — если пользователь еще не вошел)
  const [currentUser, setCurrentUser] = useState(null);

  /**
   * Обработчик успешной авторизации или регистрации.
   * Сохраняет объект пользователя из таблицы `users` в состояние приложения.
   *
   * @param {Object} user - Профиль пользователя (id, phone, full_name, role)
   */
  const handleAuthSuccess = (user) => {
    setCurrentUser(user);
  };

  /**
   * Обработчик выхода из аккаунта.
   * Сбрасывает текущего пользователя и возвращает приложение на экран входа.
   */
  const handleLogout = () => {
    setCurrentUser(null);
  };

  return (
    <div className="min-h-screen bg-beauty-light flex flex-col justify-between p-4">
      {/* Верхняя панель приложения с брендингом и статусом сессии */}
      <header className="w-full max-w-5xl mx-auto bg-beauty-dark text-white px-6 py-4 rounded-2xl shadow-lg flex flex-wrap gap-4 justify-between items-center">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold tracking-wider">BEAUTY HUB</h1>
          <span className="text-xs sm:text-sm bg-beauty px-3 py-1 rounded-full">MVP v1.0</span>
        </div>

        {/* Если пользователь вошел — показываем его имя, роль и кнопку выхода */}
        {currentUser && (
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              <p className="font-semibold">{currentUser.full_name}</p>
              <p className="text-beauty-light/80 text-xs">
                {currentUser.role === 'master' ? 'Кабинет мастера' : 'Кабинет клиента'} • {currentUser.phone}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="bg-beauty-accent hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-xl transition duration-200"
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
          
          <div className="space-y-6">
                      {/* ВЕТКА 2: Авторизован мастер — приветствие и управление услугами */}
                      <section className="bg-white p-6 sm:p-8 rounded-2xl shadow-md border border-beauty-light text-left">
                        <h2 className="text-2xl font-bold text-beauty-dark mb-2">
                          Добро пожаловать, {currentUser.full_name}
                        </h2>
                        <p className="text-gray-600">
                          Управляйте своим набором услуг ниже. Далее подключим расписание и записи клиентов.
                        </p>
                      </section>
          
                      <MasterServices master={currentUser} />
                    </div>
        ) : (
          /* ВЕТКА 3: Авторизован клиент — показываем заготовку кабинета клиента */
          <section className="bg-white p-8 rounded-2xl shadow-md border border-beauty-light">
            <h2 className="text-2xl font-bold text-beauty-dark mb-2">
              Привет, {currentUser.full_name}!
            </h2>
            <p className="text-gray-600 mb-6">
              Здесь вы сможете выбрать услугу, подобрать удобное время и посмотреть свои записи.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
              <div className="p-4 rounded-xl bg-beauty-light/60 border border-beauty-light">
                <h3 className="font-semibold text-beauty-dark mb-1">Новая запись</h3>
                <p className="text-sm text-gray-600">Выбор услуги и свободного окошка у мастера.</p>
              </div>
              <div className="p-4 rounded-xl bg-beauty-light/60 border border-beauty-light">
                <h3 className="font-semibold text-beauty-dark mb-1">Мои записи</h3>
                <p className="text-sm text-gray-600">Активные бронирования и напоминания.</p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Нижний колонтитул */}
      <footer className="w-full max-w-5xl mx-auto text-center text-sm text-gray-500 py-2">
        Beauty Hub • Клиентский и мастерский кабинеты
      </footer>
    </div>
  );
}