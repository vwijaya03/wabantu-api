import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * When every core field fails as "undefined", the request body was almost
 * certainly never parsed as JSON (missing Content-Type, raw text, or
 * `{}` after whitelist stripped unknown keys). Return one actionable
 * message instead of a wall of class-validator noise.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const core = ['email', 'password', 'name', 'businessName'] as const;
  const byProp = new Map(errors.map((e) => [e.property, e]));

  const allCorePresent = core.every((p) => byProp.has(p));
  const allCoreValueMissing = core.every((p) => {
    const v: unknown = byProp.get(p)?.value as unknown;
    return v === undefined || v === null || v === '';
  });

  if (allCorePresent && allCoreValueMissing) {
    return new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: [
        'Body request kosong atau tidak ter-parse sebagai JSON.',
        'Wajib header: Content-Type: application/json',
        'Contoh: {"email":"user@example.com","password":"ExamplePass123","name":"Nama User","businessName":"Nama Toko"}',
        'Nama field harus camelCase: businessName (bukan business_name).',
      ],
    });
  }

  const messages = errors.flatMap((e) =>
    e.constraints ? Object.values(e.constraints) : [],
  );
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: messages.length ? messages : ['Validasi gagal'],
  });
}
