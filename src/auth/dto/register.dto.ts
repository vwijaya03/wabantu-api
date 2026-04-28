import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password minimal 8 karakter' })
  @MaxLength(128)
  @Matches(/[a-zA-Z]/, { message: 'Password harus mengandung huruf' })
  @Matches(/[0-9]/, { message: 'Password harus mengandung angka' })
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /** Display name of the business that becomes the tenant. */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  businessName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slug?: string;
}
