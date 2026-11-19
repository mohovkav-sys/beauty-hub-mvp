import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Компонент авторизации с фиксированным префиксом "+7" для телефона,
 * валидацией полей и подробными комментариями на русском языке.
 */
export default function Auth({ onAuthSuccess }) {
  const [phoneDigits, setPhoneDigits] = useState(''); // Храним 10 цифр номера после +7
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('client'); // Роль по умолчанию — клиент
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError(null);

    // 1. Валидация имени
    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setError('Имя должно содержать хотя бы 2 символа.');
      return;
    }

    // 2. Валидация телефона (строго 10 цифр после +7)
    if (phoneDigits.length < 10) {
      setError('Введите полный номер телефона (10 цифр после +7).');
      return;
    }

    // Формируем итоговый номер для базы данных в формате +79991234567
    const fullPhoneNumber = `+7${phoneDigits}`;

    setLoading(true);

    try {
      // 3. Проверяем, существует ли пользователь в таблице users по этому телефону
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('phone', fullPhoneNumber)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existingUser) {
        // Если пользователь найден — успешно авторизуем
        onAuthSuccess(existingUser);
      } else {
        // 4. Если пользователя нет — создаем новую запись в базе данных
        const { data: newUser, error: insertError } = await supabase
          .from('users')
          .insert([
            { phone: fullPhoneNumber, full_name: trimmedName, role }
          ])
          .select()
          .single();

        if (insertError) throw insertError;
        onAuthSuccess(newUser);
      }
    } catch (err) {
      console.error('Ошибка авторизации:', err.message);
      setError('Ошибка при обращении к базе данных: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-lg border border-beauty-light">
      <h2 className="text-2xl font-bold text-beauty-dark mb-6 text-center">Вход в Beauty Hub</h2>
      
      {/* Блок вывода ошибок валидации или сети */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-xl text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleAuth} className="space-y-4">
        {/* Поле ввода телефона со статическим префиксом +7 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Номер телефона</label>
          <div className="relative flex items-center">
            {/* Статический визуальный префикс +7 */}
            <span className="absolute left-3 text-gray-500 font-medium select-none">
              +7
            </span>
            <input
              type="tel"
              required
              placeholder="(999) 000-00-00"
              value={phoneDigits}
              onChange={(e) => {
                // Автоматически очищаем ввод от всего, кроме цифр, и ограничиваем до 10 символов
                const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                setPhoneDigits(digits);
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-beauty"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">Введите 10 цифр номера (например, 9991234567)</p>
        </div>

        {/* Поле ввода имени */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ваше имя</label>
          <input
            type="text"
            required
            placeholder="Анна Смирнова"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-beauty"
          />
        </div>

        {/* Выбор роли (Клиент или Мастер) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Кто вы?</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-beauty bg-white"
          >
            <option value="client">Клиент (хочу записаться)</option>
            <option value="master">Мастер (принимаю записи)</option>
          </select>
        </div>

        {/* Кнопка отправки формы */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-beauty hover:bg-beauty-dark text-white font-semibold py-3 rounded-xl transition duration-200 shadow-md disabled:opacity-50"
        >
          {loading ? 'Проверка...' : 'Продолжить'}
        </button>
      </form>
    </div>
  );
}