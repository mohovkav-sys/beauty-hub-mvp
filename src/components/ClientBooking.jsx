import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
// Подключаем вынесенные стили горизонтального степпера онбординга
import './ClientBooking.css';

// Шаг сетки доступного времени внутри рабочей смены мастера (в минутах)
const SLOT_STEP_MINUTES = 30;

// Конфигурация 3 шагов пошагового онбординга записи клиента
const ONBOARDING_STEPS = [
  { id: 1, title: 'Мастер', subtitle: 'Выберите специалиста' },
  { id: 2, title: 'Услуга', subtitle: 'Выберите процедуру' },
  { id: 3, title: 'Дата и время', subtitle: 'Подберите свободный слот' },
];

/**
 * Переводит объект Date в локальный строковый ключ 'YYYY-MM-DD' без сдвига часового пояса по UTC.
 * Используется для точного сопоставления с колонкой `date` в таблице `schedule`.
 *
 * @param {Date} dateObj - Объект даты JavaScript
 * @returns {string} Строка даты вида '2026-11-20'
 */
function formatLocalDateKey(dateObj) {
  const year = dateObj.getFullYear(); // Извлекаем 4-значный год
  const month = String(dateObj.getMonth() + 1).padStart(2, '0'); // Месяцы в JS идут с 0, дополняем нулём слева
  const day = String(dateObj.getDate()).padStart(2, '0'); // День месяца, дополняем нулём слева
  return `${year}-${month}-${day}`; // Возвращаем единый формат ключа
}

/**
 * Конвертирует технический ключ даты 'YYYY-MM-DD' в российский формат 'ДД.ММ.ГГГГ' для интерфейса.
 *
 * @param {string} dateKey - Дата в формате 'YYYY-MM-DD'
 * @returns {string} Дата в формате 'ДД.ММ.ГГГГ'
 */
function formatRussianDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return ''; // Защита от пустых и нестроковых значений
  const parts = dateKey.split('-'); // Разбиваем дату по дефису на [год, месяц, день]
  if (parts.length !== 3) return dateKey; // Если формат нестандартный, возвращаем как есть
  const [year, month, day] = parts; // Деструктурируем части даты
  return `${day}.${month}.${year}`; // Собираем строку строго в порядке день.месяц.год
}

/**
 * Переводит строковое время смены ('09:00' или '09:00:00') в количество минут от начала суток (00:00).
 * Упрощает сравнение интервалов и расчёт свободных окон.
 *
 * @param {string} timeStr - Время в формате 'HH:MM' или 'HH:MM:SS'
 * @returns {number|null} Количество минут от полуночи или null при некорректной строке
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null; // Проверяем наличие корректной строки
  const parts = timeStr.split(':'); // Делим время по двоеточию
  if (parts.length < 2) return null; // Нужно минимум 2 компонента: часы и минуты
  const hours = Number(parts[0]); // Преобразуем часы в число
  const minutes = Number(parts[1]); // Преобразуем минуты в число
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null; // Отсекаем некорректные числа
  return hours * 60 + minutes; // Считаем общее число минут от начала дня
}

/**
 * Переводит количество минут от начала суток обратно в читаемую строку 'HH:MM'.
 *
 * @param {number} totalMinutes - Количество минут от полуночи
 * @returns {string} Строка времени вида '14:30'
 */
function formatMinutesToHHMM(totalMinutes) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, totalMinutes)); // Ограничиваем диапазон одними сутками (0..1439)
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0'); // Выделяем целые часы
  const minutes = String(clamped % 60).padStart(2, '0'); // Выделяем остаток минут
  return `${hours}:${minutes}`; // Формируем строку 'HH:MM'
}

/**
 * Собирает локальную дату ('YYYY-MM-DD') и локальное время ('HH:MM') в строку формата ISO 8601
 * для записи в колонку `slot_time` (timestamp with time zone) таблицы `bookings` в Supabase.
 *
 * @param {string} dateKey - Локальная дата 'YYYY-MM-DD'
 * @param {string} hhmm - Локальное время 'HH:MM'
 * @returns {string|null} Валидная ISO-строка или null при ошибке разбора
 */
function buildSlotIsoFromLocalDateAndTime(dateKey, hhmm) {
  if (!dateKey || !hhmm) return null; // Проверяем, что переданы оба параметра
  const [year, month, day] = dateKey.split('-').map(Number); // Разбираем дату в числа
  const [hours, minutes] = hhmm.split(':').map(Number); // Разбираем время в числа
  if ([year, month, day, hours, minutes].some((val) => Number.isNaN(val))) {
    return null; // Если хотя бы одно значение не число — прерываем
  }
  const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0); // Создаём объект Date в локальном часовом поясе
  if (Number.isNaN(localDate.getTime())) return null; // Проверяем валидность собранной даты
  return localDate.toISOString(); // Возвращаем UTC ISO-строку для сохранения в PostgreSQL
}

/**
 * Компонент пошагового онбординга онлайн-записи клиента:
 * Шаг 1: Выбор мастера
 * Шаг 2: Выбор услуги выбранного мастера
 * Шаг 3: Выбор рабочей даты (ДД.ММ.ГГГГ), свободного слота и подтверждение бронирования
 *
 * @param {Object} props - Свойства компонента
 * @param {Object} props.client - Профиль авторизованного клиента из таблицы `users`
 */
export default function ClientBooking({ client, onBookingCreated }) {
  // Номер активного шага онбординга (1 — Мастер, 2 — Услуга, 3 — Дата и время)
  const [currentStep, setCurrentStep] = useState(1);

  // Списки данных, загружаемые из Supabase
  const [masters, setMasters] = useState([]); // Все мастера (role = 'master')
  const [masterServices, setMasterServices] = useState([]); // Услуги выбранного мастера
  const [masterScheduleRows, setMasterScheduleRows] = useState([]); // Рабочие дни выбранного мастера
  const [masterBusyIntervalsByDate, setMasterBusyIntervalsByDate] = useState({}); // Карта занятых интервалов по датам

  // Состояние выбранных клиентом параметров записи
  const [selectedMasterId, setSelectedMasterId] = useState(''); // ID выбранного мастера
  const [selectedServiceId, setSelectedServiceId] = useState(''); // ID выбранной услуги
  const [selectedDateKey, setSelectedDateKey] = useState(''); // Выбранная дата ('YYYY-MM-DD')
  const [selectedSlotHHMM, setSelectedSlotHHMM] = useState(''); // Выбранное время начала ('HH:MM')

  // Флаги загрузки, отправки и сообщения пользователю
  const [loadingMasters, setLoadingMasters] = useState(true); // Индикатор загрузки мастеров
  const [loadingServices, setLoadingServices] = useState(false); // Индикатор загрузки услуг
  const [loadingAvailability, setLoadingAvailability] = useState(false); // Индикатор загрузки расписания и броней
  const [submitting, setSubmitting] = useState(false); // Блокировка кнопки во время сохранения записи
  const [error, setError] = useState(null); // Текст ошибки валидации или сетевого запроса
  const [notice, setNotice] = useState(null); // Сообщение об успешном создании записи

  /**
   * Загружает список всех специалистов с ролью 'master' из таблицы `users` для Шага 1.
   */
  const fetchMasters = useCallback(async () => {
    setLoadingMasters(true); // Включаем индикатор загрузки
    setError(null); // Сбрасываем старые ошибки

    try {
      const { data, error: mastersError } = await supabase
        .from('users') // Обращаемся к таблице пользователей
        .select('id, full_name, phone, role') // Запрашиваем только нужные поля
        .eq('role', 'master') // Фильтруем только мастеров
        .order('full_name', { ascending: true }); // Сортируем по имени по алфавиту

      if (mastersError) throw mastersError; // Передаём ошибку БД в блок catch
      setMasters(data || []); // Сохраняем список мастеров в состояние
    } catch (err) {
      console.error('Ошибка загрузки списка мастеров:', err.message); // Логируем детали в консоль
      setError('Не удалось загрузить список мастеров. Проверьте подключение.'); // Показываем понятную ошибку в UI
    } finally {
      setLoadingMasters(false); // Выключаем индикатор загрузки
    }
  }, []);

  // Запускаем первичную загрузку мастеров при монтировании компонента
  useEffect(() => {
    fetchMasters();
  }, [fetchMasters]);

  /**
   * Загружает список услуг конкретного мастера из таблицы `services` для Шага 2.
   *
   * @param {string} masterId - UUID выбранного мастера
   */
  const fetchServicesForMaster = useCallback(async (masterId) => {
    if (!masterId) {
      setMasterServices([]); // Если мастер не выбран — очищаем список услуг
      return;
    }

    setLoadingServices(true); // Показываем индикатор загрузки услуг
    setError(null); // Очищаем ошибки

    try {
      const { data, error: servicesError } = await supabase
        .from('services') // Обращаемся к таблице услуг
        .select('*') // Получаем поля услуги (id, title, price, duration_minutes и др.)
        .eq('master_id', masterId) // Выбираем услуги только выбранного мастера
        .order('title', { ascending: true }); // Сортируем услуги по названию

      if (servicesError) throw servicesError; // Пробрасываем ошибку запроса

      // Отфильтровываем скрытые услуги, если в схеме таблицы используется флаг is_active
      const visibleServices = (data || []).filter((item) => item.is_active !== false);
      setMasterServices(visibleServices); // Сохраняем доступные услуги мастера
    } catch (err) {
      console.error('Ошибка загрузки услуг мастера:', err.message);
      setError('Не удалось загрузить услуги выбранного мастера.');
    } finally {
      setLoadingServices(false); // Завершаем загрузку
    }
  }, []);

  // Подгружаем услуги каждый раз при смене выбранного мастера
  useEffect(() => {
    if (selectedMasterId) {
      fetchServicesForMaster(selectedMasterId);
    } else {
      setMasterServices([]);
    }
  }, [selectedMasterId, fetchServicesForMaster]);

  /**
   * Загружает рабочие смены мастера из `schedule` и активные записи из `bookings` для Шага 3,
   * формируя карту занятых временных интервалов по дням.
   *
   * @param {string} masterId - UUID выбранного мастера
   */
  const fetchMasterAvailability = useCallback(async (masterId) => {
    if (!masterId) {
      setMasterScheduleRows([]);
      setMasterBusyIntervalsByDate({});
      return;
    }

    setLoadingAvailability(true); // Включаем индикатор загрузки расписания
    setError(null);

    const now = new Date(); // Текущие дата и время
    const todayKey = formatLocalDateKey(now); // Сегодняшний ключ 'YYYY-MM-DD', чтобы не показывать прошедшие дни
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); // Запас в 1 день для учёта часовых поясов
    const fromIso = `${formatLocalDateKey(yesterday)}T00:00:00.000Z`; // Нижняя граница выборки броней

    try {
      // Параллельно запрашиваем рабочие дни из `schedule` и неотменённые записи из `bookings`
      const [
        { data: scheduleRows, error: scheduleError },
        { data: bookingRows, error: bookingsError },
      ] = await Promise.all([
        supabase
          .from('schedule')
          .select('id, master_id, date, start_time, end_time, is_available')
          .eq('master_id', masterId)
          .eq('is_available', true) // Берём только открытые для записи дни
          .gte('date', todayKey) // Только сегодняшние и будущие даты
          .order('date', { ascending: true }), // Сортируем даты по возрастанию
        supabase
          .from('bookings')
          .select('id, master_id, slot_time, status, services(duration_minutes)')
          .eq('master_id', masterId)
          .neq('status', 'cancelled') // Отменённые записи не занимают время мастера
          .gte('slot_time', fromIso),
      ]);

      if (scheduleError) throw scheduleError;
      if (bookingsError) throw bookingsError;

      setMasterScheduleRows(scheduleRows || []); // Сохраняем рабочие дни мастера

      // Группируем занятые интервалы [startMins, endMins] по ключу локальной даты
      const busyMap = {};
      (bookingRows || []).forEach((booking) => {
        if (!booking.slot_time) return; // Пропускаем некорректные записи без времени
        const slotDate = new Date(booking.slot_time); // Переводим UTC timestamp в локальное время браузера
        if (Number.isNaN(slotDate.getTime())) return;

        const dateKey = formatLocalDateKey(slotDate); // Получаем локальный день записи
        const startMins = slotDate.getHours() * 60 + slotDate.getMinutes(); // Начало занятого слота в минутах
        const rawDuration = Number(booking.services?.duration_minutes); // Длительность забронированной услуги
        const duration =
          Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 60; // По умолчанию 60 минут
        const endMins = startMins + duration; // Конец занятого интервала в минутах

        if (!busyMap[dateKey]) {
          busyMap[dateKey] = []; // Инициализируем массив занятых интервалов на эту дату
        }
        busyMap[dateKey].push({ startMins, endMins }); // Добавляем занятый отрезок
      });

      setMasterBusyIntervalsByDate(busyMap); // Сохраняем карту занятости
    } catch (err) {
      console.error('Ошибка загрузки расписания мастера:', err.message);
      setError('Не удалось загрузить рабочие дни и расписание мастера.');
    } finally {
      setLoadingAvailability(false); // Выключаем индикатор загрузки
    }
  }, []);

  // Загружаем актуальное расписание и занятые слоты при переходе на Шаг 3
  useEffect(() => {
    if (selectedMasterId && currentStep === 3) {
      fetchMasterAvailability(selectedMasterId);
    }
  }, [selectedMasterId, currentStep, fetchMasterAvailability]);

  // Находим полный объект выбранного мастера по его ID
  const selectedMaster = useMemo(
    () => masters.find((m) => m.id === selectedMasterId) || null,
    [masters, selectedMasterId]
  );

  // Находим полный объект выбранной услуги по её ID
  const selectedService = useMemo(
    () => masterServices.find((s) => s.id === selectedServiceId) || null,
    [masterServices, selectedServiceId]
  );

  // Вычисляем длительность выбранной услуги в минутах (безопасное значение по умолчанию — 60 мин)
  const serviceDurationMinutes = useMemo(() => {
    const raw = Number(selectedService?.duration_minutes);
    return Number.isFinite(raw) && raw > 0 ? raw : 60;
  }, [selectedService]);

  // Находим строку расписания (`start_time`, `end_time`) для выбранной клиентом даты
  const selectedScheduleRow = useMemo(
    () => masterScheduleRows.find((row) => row.date === selectedDateKey) || null,
    [masterScheduleRows, selectedDateKey]
  );

  /**
   * Рассчитывает список свободных слотов начала записи ('HH:MM') на выбранную дату:
   * 1) идёт по смене мастера с шагом SLOT_STEP_MINUTES;
   * 2) проверяет, что процедура целиком помещается до конца смены;
   * 3) исключает прошедшее время для сегодняшней даты;
   * 4) исключает слоты, пересекающиеся с уже занятыми интервалами.
   */
  const availableTimeSlots = useMemo(() => {
    if (!selectedScheduleRow || !selectedService) return []; // Без выбранной даты и услуги слотов нет

    const shiftStart = parseTimeToMinutes(selectedScheduleRow.start_time); // Начало смены в минутах
    const shiftEnd = parseTimeToMinutes(selectedScheduleRow.end_time); // Конец смены в минутах
    if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) {
      return []; // Некорректный интервал смены
    }

    const busyIntervals = masterBusyIntervalsByDate[selectedDateKey] || []; // Занятые интервалы на выбранный день
    const now = new Date();
    const isToday = selectedDateKey === formatLocalDateKey(now); // Проверяем, выбран ли сегодняшний день
    const currentMinutesNow = now.getHours() * 60 + now.getMinutes(); // Текущее время в минутах

    const slots = [];
    for (
      let candidateStart = shiftStart;
      candidateStart + serviceDurationMinutes <= shiftEnd;
      candidateStart += SLOT_STEP_MINUTES
    ) {
      const candidateEnd = candidateStart + serviceDurationMinutes; // Ожидаемое время окончания услуги

      // Не предлагаем слоты, которые уже начались или прошли сегодня
      if (isToday && candidateStart <= currentMinutesNow) {
        continue;
      }

      // Проверяем пересечение отрезков [candidateStart, candidateEnd) и [busy.startMins, busy.endMins)
      const overlapsBusy = busyIntervals.some(
        (busy) => candidateStart < busy.endMins && candidateEnd > busy.startMins
      );

      if (!overlapsBusy) {
        slots.push(formatMinutesToHHMM(candidateStart)); // Добавляем свободный слот в список
      }
    }

    return slots;
  }, [
    selectedScheduleRow,
    selectedService,
    masterBusyIntervalsByDate,
    selectedDateKey,
    serviceDurationMinutes,
  ]);

  /**
   * Обработчик выбора мастера на Шаге 1.
   * При смене мастера сбрасывает зависимые параметры (услугу, дату и слот).
   *
   * @param {string} masterId - UUID выбранного мастера
   */
  const handleSelectMaster = (masterId) => {
    if (masterId !== selectedMasterId) {
      setSelectedMasterId(masterId); // Запоминаем нового мастера
      setSelectedServiceId(''); // Сбрасываем выбранную услугу прошлого мастера
      setSelectedDateKey(''); // Сбрасываем выбранную дату
      setSelectedSlotHHMM(''); // Сбрасываем выбранное время
    }
    setError(null);
    setNotice(null);
  };

  /**
   * Обработчик выбора услуги на Шаге 2.
   * При смене услуги сбрасывает дату и время (так как у новой услуги может быть другая длительность).
   *
   * @param {string} serviceId - UUID выбранной услуги
   */
  const handleSelectService = (serviceId) => {
    if (serviceId !== selectedServiceId) {
      setSelectedServiceId(serviceId); // Запоминаем выбранную услугу
      setSelectedDateKey(''); // Сбрасываем дату
      setSelectedSlotHHMM(''); // Сбрасываем слот
    }
    setError(null);
    setNotice(null);
  };

  /**
   * Переводит онбординг на следующий шаг после проверки обязательного выбора на текущем шаге.
   */
  const handleNextStep = () => {
    setError(null);

    if (currentStep === 1) {
      if (!selectedMasterId) {
        setError('Пожалуйста, выберите мастера, чтобы перейти к выбору услуги.');
        return;
      }
      setCurrentStep(2); // Переходим к выбору услуги
      return;
    }

    if (currentStep === 2) {
      if (!selectedServiceId) {
        setError('Пожалуйста, выберите услугу, чтобы перейти к выбору даты и времени.');
        return;
      }
      setCurrentStep(3); // Переходим к выбору даты и слота
    }
  };

  /**
   * Возвращает пользователя на один шаг назад без потери ранее выбранного мастера/услуги.
   */
  const handlePrevStep = () => {
    setError(null);
    setCurrentStep((prev) => Math.max(1, prev - 1));
  };

  /**
   * Финальный обработчик отправки формы на Шаге 3:
   * проверяет доступность слота прямо перед записью (защита от гонки бронирований)
   * и сохраняет новую запись в таблицу `bookings`.
   *
   * @param {React.FormEvent} e - Событие отправки формы
   */
  const handleConfirmBooking = async (e) => {
    e.preventDefault(); // Предотвращаем перезагрузку страницы браузером
    setError(null);
    setNotice(null);

    // Валидация авторизации и всех обязательных шагов
    if (!client?.id) {
      setError('Не найден профиль клиента. Войдите в личный кабинет заново.');
      return;
    }
    if (!selectedMasterId || !selectedServiceId || !selectedDateKey || !selectedSlotHHMM) {
      setError('Завершите выбор мастера, услуги, даты и времени.');
      return;
    }

    const slotIso = buildSlotIsoFromLocalDateAndTime(selectedDateKey, selectedSlotHHMM);
    if (!slotIso) {
      setError('Некорректные дата или время записи.');
      return;
    }

    setSubmitting(true); // Блокируем кнопку отправки на время запроса

    try {
      // Повторно проверяем актуальные записи мастера на этот день перед вставкой (защита от двойной брони)
      const dayStartIso = buildSlotIsoFromLocalDateAndTime(selectedDateKey, '00:00');
      const dayEndIso = buildSlotIsoFromLocalDateAndTime(selectedDateKey, '23:59');

      const { data: freshBookings, error: checkError } = await supabase
        .from('bookings')
        .select('id, slot_time, status, services(duration_minutes)')
        .eq('master_id', selectedMasterId)
        .neq('status', 'cancelled')
        .gte('slot_time', dayStartIso)
        .lte('slot_time', dayEndIso);

      if (checkError) throw checkError;

      const desiredStartMins = parseTimeToMinutes(selectedSlotHHMM);
      const desiredEndMins = desiredStartMins + serviceDurationMinutes;

      const conflictExists = (freshBookings || []).some((b) => {
        const dt = new Date(b.slot_time);
        const bStart = dt.getHours() * 60 + dt.getMinutes();
        const bDur = Number(b.services?.duration_minutes) || 60;
        const bEnd = bStart + bDur;
        return desiredStartMins < bEnd && desiredEndMins > bStart;
      });

      if (conflictExists) {
        setError('Этот слот только что заняли. Пожалуйста, выберите другое время.');
        setSelectedSlotHHMM('');
        await fetchMasterAvailability(selectedMasterId); // Обновляем сетку свободных слотов
        return;
      }

      // Создаём подтверждённую запись в таблице `bookings`
      const { error: insertError } = await supabase.from('bookings').insert([
        {
          client_id: client.id,
          master_id: selectedMasterId,
          service_id: selectedServiceId,
          slot_time: slotIso,
          status: 'confirmed',
        },
      ]);

      if (insertError) throw insertError;

      // Формируем сообщение об успешной записи с датой строго в формате ДД.ММ.ГГГГ
      setNotice(
        `Запись подтверждена! Мастер: ${selectedMaster?.full_name || 'специалист'}, услуга: «${
          selectedService?.title || ''
        }», дата и время: ${formatRussianDate(selectedDateKey)} в ${selectedSlotHHMM}.`
      );

      // Сбрасываем выбранные слот, дату и услугу, возвращая онбординг на Шаг 1
      setSelectedSlotHHMM('');
      setSelectedDateKey('');
      setSelectedServiceId('');
      setCurrentStep(1);
      if (typeof onBookingCreated === 'function') {
        onBookingCreated();
      }
    } catch (err) {
      console.error('Ошибка при создании записи:', err.message);
      setError('Не удалось сохранить запись. Попробуйте выбрать другой слот или повторить позже.');
    } finally {
      setSubmitting(false); // Разблокируем кнопку
    }
  };

  return (
    <section className="bg-surface text-ink rounded-2xl shadow-md border border-slate-200 p-6 space-y-6 text-left">
      {/* Шапка блока онлайн-записи и горизонтальный степпер из CSS */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-brand-dark">Онлайн-запись</h2>
          <p className="text-sm text-muted mt-1">
            Пройдите 3 простых шага: выберите мастера, нужную услугу и удобное время визита.
          </p>
        </div>

        {/* Горизонтальный индикатор 3 шагов (стилизация полностью в ClientBooking.css) */}
        <ol className="booking-steps">
          {ONBOARDING_STEPS.map((step) => {
            const isActive = step.id === currentStep; // Текущий открытый шаг
            const isCompleted = step.id < currentStep; // Уже пройденный шаг
            // Переход по клику разрешён на Шаг 1, на Шаг 2 (если выбран мастер) и на Шаг 3 (если выбрана услуга)
            const canJump =
              step.id === 1 ||
              (step.id === 2 && Boolean(selectedMasterId)) ||
              (step.id === 3 && Boolean(selectedMasterId && selectedServiceId));

            // Определяем модификатор состояния кнопки шага для CSS
            const stateClass = isActive
              ? 'booking-steps__btn--active'
              : isCompleted
              ? 'booking-steps__btn--completed'
              : '';

            return (
              <li key={step.id} className="booking-steps__item">
                <button
                  type="button"
                  disabled={!canJump}
                  onClick={() => {
                    if (canJump) {
                      setError(null);
                      setCurrentStep(step.id);
                    }
                  }}
                  className={`booking-steps__btn ${stateClass}`}
                >
                  {/* Круглый бейдж с номером шага или галочкой завершения */}
                  <span className="booking-steps__badge">
                    {isCompleted ? '✓' : step.id}
                  </span>

                  {/* Текстовая часть шага: заголовок и подзаголовок (используем span внутри button) */}
                  <span className="booking-steps__content">
                    <span className="block booking-steps__title">{step.title}</span>
                    <span className="block booking-steps__subtitle">
                      {step.id === 1 && selectedMaster
                        ? selectedMaster.full_name
                        : step.id === 2 && selectedService
                        ? selectedService.title
                        : step.subtitle}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Уведомление об успешном оформлении записи */}
      {notice && (
        <div
          role="status"
          className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-sm font-medium"
        >
          {notice}
        </div>
      )}

      {/* Сообщение об ошибке валидации или работы с БД */}
      {error && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-300 text-red-900 rounded-xl text-sm font-medium"
        >
          {error}
        </div>
      )}

      {/* =====================================================================
          ШАГ 1: ВЫБОР МАСТЕРА
         ===================================================================== */}
      {currentStep === 1 && (
        <div className="space-y-5">
          <h3 className="text-base font-bold text-ink">
            Шаг 1 из 3. Выберите мастера
          </h3>

          {loadingMasters ? (
            <p className="text-sm text-muted py-4">Загружаем список мастеров...</p>
          ) : masters.length === 0 ? (
            <p className="text-sm text-muted py-4">
              Пока нет зарегистрированных мастеров.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {masters.map((master) => {
                const isSelected = master.id === selectedMasterId;
                return (
                  <button
                    key={master.id}
                    type="button"
                    onClick={() => handleSelectMaster(master.id)}
                    className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-slate-50/50 hover:border-slate-400'
                    }`}
                  >
                    <div className="font-bold text-ink">{master.full_name}</div>
                    <div className="text-xs text-muted mt-1">
                      Специалист Beauty Hub
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Кнопка перехода на Шаг 2 */}
          <div className="flex justify-end pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={handleNextStep}
              disabled={!selectedMasterId}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
                selectedMasterId
                  ? 'bg-brand hover:bg-brand-hover text-white cursor-pointer'
                  : 'bg-slate-200 text-slate-500 cursor-not-allowed'
              }`}
            >
              Далее: выбрать услугу →
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          ШАГ 2: ВЫБОР УСЛУГИ МАСТЕРА
         ===================================================================== */}
      {currentStep === 2 && (
        <div className="space-y-5">
          <h3 className="text-base font-bold text-ink">
            Шаг 2 из 3. Выберите услугу мастера{' '}
            <span className="text-brand-dark">{selectedMaster?.full_name}</span>
          </h3>

          {loadingServices ? (
            <p className="text-sm text-muted py-4">Загружаем услуги мастера...</p>
          ) : masterServices.length === 0 ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              У этого мастера пока нет активных услуг. Вернитесь назад и выберите другого специалиста.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {masterServices.map((service) => {
                const isSelected = service.id === selectedServiceId;
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => handleSelectService(service.id)}
                    className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-slate-50/50 hover:border-slate-400'
                    }`}
                  >
                    <div className="font-bold text-ink">{service.title}</div>
                    <div className="text-xs text-muted mt-1">
                      Длительность: {service.duration_minutes || 60} мин · Стоимость:{' '}
                      <span className="font-semibold text-ink">
                        {Number(service.price || 0).toLocaleString('ru-RU')} ₽
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Кнопки навигации Шага 2 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={handlePrevStep}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-ink transition cursor-pointer"
            >
              ← Назад к выбору мастера
            </button>

            <button
              type="button"
              onClick={handleNextStep}
              disabled={!selectedServiceId}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
                selectedServiceId
                  ? 'bg-brand hover:bg-brand-hover text-white cursor-pointer'
                  : 'bg-slate-200 text-slate-500 cursor-not-allowed'
              }`}
            >
              Далее: выбрать дату и время →
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          ШАГ 3: ВЫБОР ДАТЫ И ВРЕМЕНИ + ПОДТВЕРЖДЕНИЕ ЗАПИСИ
         ===================================================================== */}
      {currentStep === 3 && (
        <form onSubmit={handleConfirmBooking} className="space-y-5">
          {/* Сводка выбранных мастера и услуги */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Мастер: <strong className="text-ink">{selectedMaster?.full_name}</strong>
            </span>
            <span>
              Услуга: <strong className="text-ink">{selectedService?.title}</strong> (
              {serviceDurationMinutes} мин,{' '}
              {Number(selectedService?.price || 0).toLocaleString('ru-RU')} ₽)
            </span>
          </div>

          <h3 className="text-base font-bold text-ink">
            Шаг 3 из 3. Выберите дату и время визита
          </h3>

          {loadingAvailability ? (
            <p className="text-sm text-muted py-4">
              Загружаем рабочие дни и свободные слоты мастера...
            </p>
          ) : masterScheduleRows.length === 0 ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              У мастера {selectedMaster?.full_name} пока нет открытых рабочих дней в расписании.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Выбор рабочей даты (строго формат ДД.ММ.ГГГГ) */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">
                  Доступные даты:
                </div>
                <div className="flex flex-wrap gap-2">
                  {masterScheduleRows.map((row) => {
                    const isDateSelected = row.date === selectedDateKey;
                    return (
                      <button
                        key={row.id || row.date}
                        type="button"
                        onClick={() => {
                          setSelectedDateKey(row.date);
                          setSelectedSlotHHMM('');
                          setError(null);
                        }}
                        className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                          isDateSelected
                            ? 'bg-emerald-600 text-white border-emerald-700'
                            : 'bg-white text-ink border-slate-300 hover:border-emerald-500'
                        }`}
                      >
                        {formatRussianDate(row.date)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Выбор свободного времени начала на выбранную дату */}
              {selectedDateKey && (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">
                    Свободное время на {formatRussianDate(selectedDateKey)}:
                  </div>

                  {availableTimeSlots.length === 0 ? (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      На выбранную дату нет свободных слотов под длительность услуги (
                      {serviceDurationMinutes} мин). Выберите другую дату.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {availableTimeSlots.map((slot) => {
                        const isSlotSelected = slot === selectedSlotHHMM;
                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => {
                              setSelectedSlotHHMM(slot);
                              setError(null);
                            }}
                            className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                              isSlotSelected
                                ? 'bg-brand-dark text-white border-brand-dark'
                                : 'bg-white text-ink border-slate-300 hover:border-slate-500'
                            }`}
                          >
                            {slot}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Нижняя панель Шага 3: возврат назад и подтверждение бронирования */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={handlePrevStep}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-ink transition cursor-pointer"
            >
              ← Назад к выбору услуги
            </button>

            <button
              type="submit"
              disabled={submitting || !selectedDateKey || !selectedSlotHHMM}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
                submitting || !selectedDateKey || !selectedSlotHHMM
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-sm'
              }`}
            >
              {submitting
                ? 'Сохраняем запись...'
                : selectedDateKey && selectedSlotHHMM
                ? `Подтвердить запись (${formatRussianDate(selectedDateKey)}, ${selectedSlotHHMM})`
                : 'Подтвердить запись'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}