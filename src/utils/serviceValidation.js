/**
 * Чистые функции валидации и нормализации полей услуги мастера.
 * Не зависят от React и UI-разметки, поэтому легко переиспользуются и тестируются.
 */

export const SERVICE_DURATION_MIN = 5;
export const SERVICE_DURATION_MAX = 600;
export const SERVICE_TITLE_MIN_LENGTH = 3;

/**
 * Проверяет и нормализует параметры услуги (название, цену и длительность).
 *
 * @param {Object} params
 * @param {string} [params.title=''] - Название услуги
 * @param {string|number} params.price - Цена услуги в рублях
 * @param {string|number} params.duration - Длительность в минутах
 * @param {boolean} [params.checkTitle=false] - Нужно ли проверять название услуги
 * @returns {{
 *   valid: boolean,
 *   message?: string,
 *   trimmedTitle?: string,
 *   parsedPrice?: number,
 *   parsedDuration?: number
 * }}
 */
export function validateServiceFields({
  title = '',
  price,
  duration,
  checkTitle = false,
}) {
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';

  if (checkTitle && trimmedTitle.length < SERVICE_TITLE_MIN_LENGTH) {
    return {
      valid: false,
      message: `Название услуги должно содержать минимум ${SERVICE_TITLE_MIN_LENGTH} символа.`,
    };
  }

  const parsedPrice = Number(price);
  if (price === '' || price === null || Number.isNaN(parsedPrice) || parsedPrice < 0) {
    return {
      valid: false,
      message: 'Укажите корректную цену (число от 0 и выше).',
    };
  }

  const parsedDuration = Number(duration);
  if (
    duration === '' ||
    duration === null ||
    !Number.isInteger(parsedDuration) ||
    parsedDuration < SERVICE_DURATION_MIN ||
    parsedDuration > SERVICE_DURATION_MAX
  ) {
    return {
      valid: false,
      message: `Укажите длительность в минутах (целое число от ${SERVICE_DURATION_MIN} до ${SERVICE_DURATION_MAX}).`,
    };
  }

  return {
    valid: true,
    trimmedTitle,
    parsedPrice,
    parsedDuration,
  };
}