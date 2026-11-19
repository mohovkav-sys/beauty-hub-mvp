import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Компонент авторизации/регистрации для «Beauty Hub».
 * - Клиенты при первом входе автоматически регистрируются в таблице `users`.
 * - Мастера НЕ создаются через форму: войти может только существующий в БД мастер с role = 'master'.
 *
 * @param {Object} props
 * @param {Function} props.onAuthSuccess - Колбэк при успешном входе, получает объект пользователя
 */
export default function Auth({ onAuthSuccess }) {
  // Храним ровно 10 цифр номера после статического префикса +7
  const [phoneDigits, setPhoneDigits] = useState('');
  // Имя пользователя (для клиента при регистрации/входе, для мастера — опционально/для проверки)
  const [fullName, setFullName] = useState('');
  // Выбранная вкладка/роль входа: 'client' или 'master'
  const [role, setRole] = useState('client');
  // Флаг активного сетевого запроса для блокировки кнопки
  const [loading, setLoading] = useState(false);
  // Текст ошибки валидации или отказа в доступе
  const [error, setError] = useState(null);

  /**
   * Валидирует поля формы перед обращением к базе данных.
   * Возвращает объект { valid: boolean, trimmedName: string, fullPhone: string }.
   */
  const validateForm = () => {
    const trimmedName = fullName.trim();

    // Для клиента имя обязательно (минимум 2 символа)
    if (role === 'client' && trimmedName.length < 2) {
      setError('Введите ваше имя (минимум 2 символа).');
      return { valid: false };
    }

    // Номер телефона должен содержать строго 10 цифр после +7
    if (phoneDigits.length !== 10) {
      setError('Введите корректный номер телефона — ровно 10 цифр после +7.');
      return { valid: false };
    }

    return {
      valid: true,
      trimmedName,
      fullPhone: `+7${phoneDigits}`,
    };
  };

  /**
   * Ищет существующего пользователя в таблице `users` по номеру телефона.
   * При необходимости фильтрует по роли.
   *
   * @param {string} fullPhone - Телефон в формате +7XXXXXXXXXX
   * @param {string|null} requiredRole - Если передана роль (например, 'master'), ищет только с ней
   */
  const findExistingUser = async (fullPhone, requiredRole = null) => {
    let query = supabase
      .from('users')
      .select('*')
      .eq('phone', fullPhone);

    if (requiredRole) {
      query = query.eq('role', requiredRole);
    }

    const { data, error: fetchError } = await query.maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    return data;
  };

  /**
   * Создает нового пользователя в таблице `users`.
   * Вызывается ТОЛЬКО для роли 'client', если запись с таким телефоном еще не найдена.
   *
   * @param {Object} userPayload - Данные нового клиента ({ phone, full_name, role })
   */
  const createClientUser = async (userPayload) => {
    const { data, error: insertError } = await supabase
      .from('users')
      .insert([userPayload])
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    return data;
  };

  /**
   * Обрабатывает отправку формы входа/регистрации.
   * Разделяет сценарии для мастера (строго существующая запись в БД)
   * и клиента (вход существующего или создание нового профиля).
   *
   * @param {React.FormEvent} e - Событие отправки формы
   */
  const handleAuth = async (e) => {
    e.preventDefault();
    setError(null);

    // 1. Проверяем корректность введенных данных
    const { valid, trimmedName, fullPhone } = validateForm();
    if (!valid) {
      return;
    }

    setLoading(true);

    try {
      // 2. ВЕТКА МАСТЕРА: регистрация запрещена, проверяем наличие мастера в базе
      if (role === 'master') {
        const existingMaster = await findExistingUser(fullPhone, 'master');

        if (!existingMaster) {
          // Не создаем нового мастера — отказываем во входе
          setError('Доступ запрещен: мастер с таким номером не найден в базе.');
          return;
        }

        onAuthSuccess(existingMaster);
        return;
      }

      // 3. ВЕТКА КЛИЕНТА: сначала ищем по телефону
      const existingUser = await findExistingUser(fullPhone);

      if (existingUser) {
        // Если по этому номеру уже зарегистрирован мастер, не перезаписываем его роль
        if (existingUser.role === 'master') {
          setError('Этот номер закреплен за мастером. Переключите роль на «Мастер» для входа.');
          return;
        }

        onAuthSuccess(existingUser);
        return;
      }

      // 4. Если клиент новый — создаем запись в таблице `users`
      const newClient = await createClientUser({
        phone: fullPhone,
        full_name: trimmedName,
        role: 'client',
      });

      onAuthSuccess(newClient);
    } catch (err) {
      console.error('Ошибка при авторизации:', err.message);
      setError('Не удалось выполнить вход. Попробуйте еще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-lg border border-beauty-light">
      <h2 className="text-2xl font-bold text-beauty-dark mb-6 text-center">
        Вход в Beauty Hub
      </h2>

      {/* Блок отображения ошибок валидации и отказа во входе */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-xl text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleAuth} className="space-y-4">
        {/* Выбор роли: для клиента возможна регистрация, для мастера — только вход из БД */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Кто вы?
          </label>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setError(null);
            }}
            className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-beauty bg-white"
          >
            <option value="client">Клиент (вход или быстрая регистрация)</option>
            <option value="master">Мастер (вход только для зарегистрированных в базе)</option>
          </select>
        </div>

        {/* Поле ввода телефона со статическим префиксом +7 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Номер телефона
          </label>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-gray-500 font-medium select-none">
              +7
            </span>
            <input
              type="tel"
              required
              placeholder="9990000000"
              value={phoneDigits}
              onChange={(e) => {
                // Оставляем только цифры и ограничиваем длину 10 символами
                const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                setPhoneDigits(digits);
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-beauty"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Введите 10 цифр номера без +7
          </p>
        </div>

        {/* Поле ввода имени отображаем для клиента (для мастера имя уже хранится в БД) */}
        {role === 'client' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ваше имя
            </label>
            <input
              type="text"
              required
              placeholder="Анна Смирнова"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-beauty"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-beauty hover:bg-beauty-dark text-white font-semibold py-3 rounded-xl transition duration-200 shadow-md disabled:opacity-50"
        >
          {loading ? 'Проверяем...' : 'Продолжить'}
        </button>
      </form>
    </div>
  );
}