import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import './Auth.css';

/**
 * Компонент авторизации/регистрации для «Beauty Hub».
 * - Клиенты могут войти по существующему номеру или зарегистрироваться автоматически.
 * - Мастера входят только по номеру, уже существующему в таблице `users` с ролью `master`.
 *
 * @param {Object} props
 * @param {Function} props.onAuthSuccess - Колбэк при успешном входе, получает объект пользователя
 */
export default function Auth({ onAuthSuccess }) {
  // Ровно 10 цифр номера телефона после фиксированного префикса +7
  const [phoneDigits, setPhoneDigits] = useState('');
  // Имя клиента (для мастера берется из базы данных)
  const [fullName, setFullName] = useState('');
  // Выбранная роль входа: 'client' или 'master'
  const [role, setRole] = useState('client');
  // Состояние загрузки во время запроса к Supabase
  const [loading, setLoading] = useState(false);
  // Сообщение об ошибке валидации, доступа или сети
  const [error, setError] = useState(null);

  /**
   * Проверяет корректность введенных данных перед отправкой запроса в БД.
   *
   * @returns {{ valid: boolean, trimmedName?: string, fullPhone?: string }}
   */
  const validateForm = () => {
    const trimmedName = fullName.trim();

    // Имя обязательно при входе/регистрации клиента
    if (role === 'client' && trimmedName.length < 2) {
      setError('Введите ваше имя (минимум 2 символа).');
      return { valid: false };
    }

    // Номер телефона должен содержать ровно 10 цифр после +7
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
   * Ищет пользователя в таблице `users` по номеру телефона и (опционально) по роли.
   *
   * @param {string} fullPhone - Номер телефона в формате +7XXXXXXXXXX
   * @param {string|null} requiredRole - Обязательная роль ('master' или 'client') либо null
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
   * Создает нового клиента в таблице `users`.
   * Вызывается только для роли 'client', если пользователь еще не зарегистрирован.
   *
   * @param {{ phone: string, full_name: string, role: string }} userPayload
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
   * Обрабатывает отправку формы входа или регистрации.
   *
   * @param {React.FormEvent} e - Событие отправки формы
   */
  const handleAuth = async (e) => {
    e.preventDefault();
    setError(null);

    // 1. Валидируем поля ввода
    const { valid, trimmedName, fullPhone } = validateForm();
    if (!valid) {
      return;
    }

    setLoading(true);

    try {
      // 2. Вход мастера: регистрация запрещена, проверяем наличие в БД
      if (role === 'master') {
        const existingMaster = await findExistingUser(fullPhone, 'master');

        if (!existingMaster) {
          setError('Доступ запрещен: мастер с таким номером не найден в базе.');
          return;
        }

        onAuthSuccess(existingMaster);
        return;
      }

      // 3. Вход/регистрация клиента
      const existingUser = await findExistingUser(fullPhone);

      if (existingUser) {
        if (existingUser.role === 'master') {
          setError('Этот номер закреплен за мастером. Выберите роль «Мастер».');
          return;
        }

        onAuthSuccess(existingUser);
        return;
      }

      // 4. Создаем нового клиента, если запись не найдена
      const newClient = await createClientUser({
        phone: fullPhone,
        full_name: trimmedName,
        role: 'client',
      });

      onAuthSuccess(newClient);
    } catch (err) {
      console.error('Ошибка при авторизации:', err.message);
      setError('Не удалось выполнить вход. Проверьте соединение и попробуйте снова.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900">
          Вход в Beauty Hub
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          {role === 'client'
            ? 'Укажите номер и имя для записи или входа'
            : 'Вход только для зарегистрированных мастеров'}
        </p>
      </div>

      {/* Блок вывода ошибок */}
      {error && (
        <div
          role="alert"
          className="mb-5 p-3.5 bg-red-50 border border-red-300 text-red-800 rounded-xl text-sm font-medium"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleAuth} className="space-y-4">
        {/* Выбор роли */}
        <div>
          <label
            htmlFor="auth-role"
            className="block text-sm font-semibold text-slate-800 mb-1.5"
          >
            Кто вы?
          </label>
          <select
            id="auth-role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setError(null);
            }}
            className="auth-field-control"
          >
            <option value="client">Клиент (вход или быстрая регистрация)</option>
            <option value="master">Мастер</option>
          </select>
        </div>

        {/* Поле телефона со статическим префиксом +7 */}
        <div>
          <label
            htmlFor="auth-phone"
            className="block text-sm font-semibold text-slate-800 mb-1.5"
          >
            Номер телефона
          </label>
          <div className="auth-phone-group">
            <span className="auth-phone-prefix">+7</span>
            <input
              id="auth-phone"
              type="tel"
              inputMode="numeric"
              required
              placeholder="9990000000"
              value={phoneDigits}
              onChange={(e) => {
                // Оставляем только цифры и ограничиваем длину 10 символами
                const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                setPhoneDigits(digits);
              }}
              className="auth-phone-input"
            />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            Введите 10 цифр номера без +7 ({phoneDigits.length}/10)
          </p>
        </div>

        {/* Поле имени для клиента */}
        {role === 'client' && (
          <div>
            <label
              htmlFor="auth-name"
              className="block text-sm font-semibold text-slate-800 mb-1.5"
            >
              Ваше имя
            </label>
            <input
              id="auth-name"
              type="text"
              required
              placeholder="Анна Смирнова"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="auth-field-control"
            />
          </div>
        )}

        {/* Кнопка отправки */}
        <button
          type="submit"
          disabled={loading}
          className="auth-submit-btn"
        >
          {loading ? 'Проверяем...' : 'Продолжить'}
        </button>
      </form>
    </div>
  );
}