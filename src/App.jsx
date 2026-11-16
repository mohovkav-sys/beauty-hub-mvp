import React from 'react';

function App() {
  return (
    <div className="min-h-screen bg-beauty-light flex flex-col items-center justify-center p-4">
      {/* Шапка в стиле Beauty Hub */}
      <header className="w-full max-w-4xl bg-beauty-dark text-white p-6 rounded-2xl shadow-lg mb-8 flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-wider">BEAUTY HUB</h1>
        <span className="text-sm bg-beauty px-3 py-1 rounded-full">MVP v1.0</span>
      </header>

      {/* Основной блок приветствия */}
      <main className="w-full max-w-4xl bg-white p-8 rounded-2xl shadow-md text-center">
        <h2 className="text-3xl font-bold text-beauty-dark mb-4">Система записи на бьюти-услуги</h2>
        <p className="text-gray-600 mb-6">
          Добро пожаловать в разработку вашего первого проекта! Базовые цвета и Tailwind CSS успешно подключены.
        </p>
        
        <div className="flex justify-center gap-4">
          <button className="bg-beauty hover:bg-beauty-dark text-white font-semibold px-6 py-3 rounded-xl transition duration-200 shadow-md">
            Записаться к мастеру
          </button>
          <button className="bg-beauty-accent hover:opacity-90 text-white font-semibold px-6 py-3 rounded-xl transition duration-200 shadow-md">
            Кабинет мастера
          </button>
        </div>
      </main>

      {/* Футер */}
      <footer className="mt-8 text-sm text-gray-500">
        Делаем всё качественно и с любовью 💜
      </footer>
    </div>
  );
}

export default App;