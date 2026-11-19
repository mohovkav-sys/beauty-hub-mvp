import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Блок управления собственными услугами в личном кабинете мастера.
 * Позволяет:
 * - просматривать только свои услуги (master_id === master.id);
 * - добавлять новую услугу с валидацией названия, цены и длительности;
 * - редактировать цену и длительность существующей услуги;
 * - переключать видимость услуги для клиента (is_active);
 * - удалять услугу только при отсутствии связанных записей в таблице `bookings`.
 *
 * @param {Object} props
 * @param {Object} props.master - Объект авторизованного мастера из таблицы `users`
 */
export default function MasterServices({ master }) {
  // Список услуг текущего мастера
  const [services, setServices] = useState([]);
  // Состояние первичной загрузки списка
  const [loading, setLoading] = useState(true);
  // Состояние выполнения операции (добавление, сохранение, удаление)
  const [submitting, setSubmitting] = useState(false);
  // Сообщения об ошибках и успешных действиях
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Поля формы добавления новой услуги
  const [newTitle, setNewTitle] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newDuration, setNewDuration] = useState('60');

  // ID услуги, которая сейчас находится в режиме редактирования цены/времени
  const [editingId, setEditingId] = useState(null);
  const [editPrice, setEditPrice] = useState('');
  const [editDuration, setEditDuration] = useState('');

  /**
   * Загружает из Supabase только услуги, закрепленные за текущим мастером.
   */
  const fetchMasterServices = useCallback(async () => {
    if (!master?.id) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('services')
        .select('id, master_id, title, price, duration_minutes, is_active')
        .eq('master_id', master.id)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      setServices(data || []);
    } catch (err) {
      console.error('Ошибка загрузки услуг мастера:', err.message);
      setError('Не удалось загрузить ваши услуги. Обновите страницу или проверьте соединение.');
    } finally {
      setLoading(false);
    }
  }, [master?.id]);

  useEffect(() => {
    fetchMasterServices();
  }, [fetchMasterServices]);

  /**
   * Валидирует параметры услуги (название, цену и длительность).
   *
   * @param {{ title?: string, price: string|number, duration: string|number, checkTitle?: boolean }} params
   * @returns {{ valid: boolean, message?: string, parsedPrice?: number, parsedDuration?: number }}
   */
  const validateServiceFields = ({ title = '', price, duration, checkTitle = false }) => {
    if (checkTitle && title.trim().length < 3) {
      return { valid: false, message: 'Название услуги должно содержать минимум 3 символа.' };
    }

    const parsedPrice = Number(price);
    if (price === '' || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      return { valid: false, message: 'Укажите корректную цену (число от 0 и выше).' };
    }

    const parsedDuration = Number(duration);
    if (
      duration === '' ||
      !Number.isInteger(parsedDuration) ||
      parsedDuration < 5 ||
      parsedDuration > 600
    ) {
      return {
        valid: false,
        message: 'Укажите длительность в минутах (целое число от 5 до 600).',
      };
    }

    return { valid: true, parsedPrice, parsedDuration };
  };

  /**
   * Добавляет новую услугу с привязкой к текущему мастеру.
   *
   * @param {React.FormEvent} e
   */
  const handleAddService = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const check = validateServiceFields({
      title: newTitle,
      price: newPrice,
      duration: newDuration,
      checkTitle: true,
    });

    if (!check.valid) {
      setError(check.message);
      return;
    }

    setSubmitting(true);

    try {
      const { data, error: insertError } = await supabase
        .from('services')
        .insert([
          {
            master_id: master.id,
            title: newTitle.trim(),
            price: check.parsedPrice,
            duration_minutes: check.parsedDuration,
            is_active: true,
          },
        ])
        .select('id, master_id, title, price, duration_minutes, is_active')
        .single();

      if (insertError) throw insertError;

      setServices((prev) => [...prev, data]);
      setNewTitle('');
      setNewPrice('');
      setNewDuration('60');
      setNotice('Новая услуга успешно добавлена в ваш прайс.');
    } catch (err) {
      console.error('Ошибка добавления услуги:', err.message);
      setError('Не удалось добавить услугу. Проверьте права доступа или заполнение полей.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Переводит конкретную услугу в режим редактирования цены и времени.
   *
   * @param {Object} service
   */
  const startEditing = (service) => {
    setError(null);
    setNotice(null);
    setEditingId(service.id);
    setEditPrice(String(service.price));
    setEditDuration(String(service.duration_minutes));
  };

  /**
   * Сохраняет обновленную цену и длительность услуги в Supabase.
   *
   * @param {string} serviceId
   */
  const handleSaveEdit = async (serviceId) => {
    setError(null);
    setNotice(null);

    const check = validateServiceFields({
      price: editPrice,
      duration: editDuration,
      checkTitle: false,
    });

    if (!check.valid) {
      setError(check.message);
      return;
    }

    setSubmitting(true);

    try {
      const { error: updateError } = await supabase
        .from('services')
        .update({
          price: check.parsedPrice,
          duration_minutes: check.parsedDuration,
        })
        .eq('id', serviceId)
        .eq('master_id', master.id); // Дополнительная защита изоляции по мастеру

      if (updateError) throw updateError;

      setServices((prev) =>
        prev.map((item) =>
          item.id === serviceId
            ? { ...item, price: check.parsedPrice, duration_minutes: check.parsedDuration }
            : item
        )
      );
      setEditingId(null);
      setNotice('Цена и время выполнения обновлены.');
    } catch (err) {
      console.error('Ошибка обновления услуги:', err.message);
      setError('Не удалось сохранить изменения услуги.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Переключает статус активности услуги (`is_active`):
   * при `false` услуга скрывается от клиентов, но сохраняется в истории записей.
   *
   * @param {Object} service
   */
  const handleToggleActive = async (service) => {
    setError(null);
    setNotice(null);
    setSubmitting(true);

    const nextActiveState = !service.is_active;

    try {
      const { error: toggleError } = await supabase
        .from('services')
        .update({ is_active: nextActiveState })
        .eq('id', service.id)
        .eq('master_id', master.id);

      if (toggleError) throw toggleError;

      setServices((prev) =>
        prev.map((item) =>
          item.id === service.id ? { ...item, is_active: nextActiveState } : item
        )
      );
      setNotice(
        nextActiveState
          ? `Услуга «${service.title}» снова видна клиентам.`
          : `Услуга «${service.title}» скрыта из каталога клиентов.`
      );
    } catch (err) {
      console.error('Ошибка переключения видимости услуги:', err.message);
      setError('Не удалось изменить видимость услуги.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Удаляет услугу из БД ТОЛЬКО если на нее нет записей в таблице `bookings`.
   * Если записи найдены, блокирует удаление и предупреждает мастера.
   *
   * @param {Object} service
   */
  const handleDeleteService = async (service) => {
    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      // 1. Проверяем наличие любых записей на эту услугу в таблице bookings
      const { count, error: countError } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('service_id', service.id);

      if (countError) throw countError;

      // 2. Если записи существуют — блокируем удаление, чтобы не сломать историю
      if (count && count > 0) {
        setError(
          `Нельзя удалить услугу «${service.title}»: на нее оформлено записей в базе — ${count} шт. Используйте кнопку «Скрыть», чтобы убрать ее из записи для новых клиентов.`
        );
        return;
      }

      // 3. Записей нет — выполняем безопасное удаление
      const { error: deleteError } = await supabase
        .from('services')
        .delete()
        .eq('id', service.id)
        .eq('master_id', master.id);

      if (deleteError) throw deleteError;

      setServices((prev) => prev.filter((item) => item.id !== service.id));
      if (editingId === service.id) {
        setEditingId(null);
      }
      setNotice(`Услуга «${service.title}» удалена.`);
    } catch (err) {
      console.error('Ошибка удаления услуги:', err.message);
      setError('Не удалось проверить записи или удалить услугу. Попробуйте позже.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-white text-slate-900 rounded-2xl shadow-md border border-slate-200 p-6 text-left">
      <div className="mb-5">
        <h3 className="text-xl font-bold text-slate-900">Мои услуги и прайс</h3>
        <p className="text-sm text-slate-600 mt-1">
          Управляйте своим набором услуг. Скрытые услуги не видны клиентам, но сохраняют историю записей.
        </p>
      </div>

      {/* Уведомления об ошибках и успешных операциях */}
      {error && (
        <div
          role="alert"
          className="mb-4 p-3.5 bg-red-50 border border-red-300 text-red-800 rounded-xl text-sm font-medium"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mb-4 p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl text-sm font-medium"
        >
          {notice}
        </div>
      )}

      {/* Форма добавления новой услуги */}
      <form
        onSubmit={handleAddService}
        className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
      >
        <div className="md:col-span-5">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Название услуги
          </label>
          <input
            type="text"
            placeholder="Например: Комбинированный маникюр"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Цена (₽)
          </label>
          <input
            type="number"
            min="0"
            step="50"
            placeholder="1500"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Время (мин)
          </label>
          <input
            type="number"
            min="5"
            max="600"
            step="5"
            placeholder="60"
            value={newDuration}
            onChange={(e) => setNewDuration(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
        </div>

        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm py-2 px-4 rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
          >
            + Добавить услугу
          </button>
        </div>
      </form>

      {/* Список услуг текущего мастера */}
      {loading ? (
        <p className="text-sm text-slate-500 py-4">Загружаем ваш список услуг...</p>
      ) : services.length === 0 ? (
        <p className="text-sm text-slate-500 py-4">
          У вас пока нет добавленных услуг. Создайте первую через форму выше.
        </p>
      ) : (
        <div className="space-y-3">
          {services.map((service) => {
            const isEditing = editingId === service.id;

            return (
              <div
                key={service.id}
                className={`p-4 rounded-xl border transition flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                  service.is_active
                    ? 'bg-white border-slate-200'
                    : 'bg-slate-100 border-slate-300 opacity-80'
                }`}
              >
                {/* Информация об услуге или поля редактирования */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{service.title}</span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        service.is_active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {service.is_active ? 'Активна' : 'Скрыта от клиентов'}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                        Цена (₽):
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-28 px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                        Время (мин):
                        <input
                          type="number"
                          min="5"
                          max="600"
                          step="5"
                          value={editDuration}
                          onChange={(e) => setEditDuration(e.target.value)}
                          className="w-24 px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600 mt-1">
                      Стоимость: <strong className="text-slate-900">{service.price} ₽</strong> •
                      Длительность: <strong className="text-slate-900">{service.duration_minutes} мин</strong>
                    </p>
                  )}
                </div>

                {/* Кнопки управления */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleSaveEdit(service.id)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold rounded-lg transition cursor-pointer"
                      >
                        Отмена
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => startEditing(service)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg border border-slate-300 transition cursor-pointer"
                      >
                        Изменить цену/время
                      </button>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleToggleActive(service)}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold rounded-lg border border-amber-300 transition cursor-pointer"
                      >
                        {service.is_active ? 'Скрыть' : 'Показать'}
                      </button>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleDeleteService(service)}
                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-lg border border-red-300 transition cursor-pointer"
                      >
                        Удалить
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}