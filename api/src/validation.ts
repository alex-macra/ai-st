// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

export const zEmail = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const zLicenseKey = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+){2,7}$/i)
  .transform((value) => value.toUpperCase());
