# Jusa Boutique · Calculadora compartida

Aplicación estática para que el equipo comparta prendas, gastos y cálculos en tiempo real. La autenticación y los datos se guardan en Supabase; este proyecto no almacena contraseñas ni inventario en `localStorage`.

## Publicarla por primera vez

1. Creá un proyecto en [Supabase](https://supabase.com/dashboard).
2. En **SQL Editor**, creá una consulta nueva, pegá el contenido completo de `supabase-schema.sql` y ejecutalo una vez.
3. En **Authentication > Providers**, comprobá que **Email** esté habilitado y dejá activada la **confirmación de correo**. Es necesaria: las invitaciones se aceptan únicamente con el correo verificado.
4. En **Project Settings > API**, copiá la **Project URL** y la clave **anon / publishable**. Pegalas en `config.js`. Nunca uses una clave `service_role` o `sb_secret` en ese archivo.
5. Si ya habías ejecutado `supabase-schema.sql` en una versión anterior, pegá y ejecutá también `supabase-security-update.sql` (una vez; se puede repetir sin problemas).
6. Publicá esta carpeta en un repositorio privado de GitHub. Después, en [Vercel](https://vercel.com), elegí **New Project**, importá el repositorio y presioná **Deploy**. Es un sitio estático: no necesita comando de compilación.
7. En Supabase, agregá la URL final de Vercel en **Authentication > URL Configuration > Site URL** y también en **Redirect URLs** (por ejemplo, `https://jusa-boutique.vercel.app`). Esto permite que el enlace de confirmación vuelva a la app. No uses rutas `file:///...`: Supabase no puede redirigir a un archivo local.

## Primer acceso y equipo

1. La encargada crea una cuenta e inicia sesión.
2. En la pantalla de preparación, crea **Jusa Boutique**. Esa cuenta queda como **Administradora**.
3. Desde **Equipo**, la administradora prepara una invitación por correo y le avisa a la persona que debe registrarse con ese mismo correo. No hace falta usar **Authentication > Users > Send invitation** del panel de Supabase.
4. Al crear y confirmar su cuenta, la persona entra automáticamente al inventario compartido. Las vendedoras pueden cargar, modificar y eliminar prendas/gastos; las administradoras también pueden invitar.

Las invitaciones actuales no envían un correo automático: solo habilitan el acceso de ese correo. Es deliberado para no requerir una clave de servicio ni un proveedor de correos adicional.

> Importante: para registrarse o confirmar correo, abrí la aplicación desde su URL de Vercel. Hacer doble clic sobre `index.html` sirve para ver el diseño, pero no es una URL web válida para la redirección de Supabase.

## Seguridad incluida

- Contraseñas gestionadas por Supabase Auth, nunca guardadas en el HTML.
- Las invitaciones se aceptan solo cuando el correo quedó verificado: registrarse con el correo de otra persona no da acceso.
- Permisos por columna: nadie puede mover una prenda o la configuración a otra boutique desde el navegador.
- Cabeceras de seguridad (CSP, HSTS, anti-clickjacking) en `vercel.json`.
- Row Level Security: solo integrantes de la boutique pueden consultar o modificar sus gastos y prendas.
- Roles de administradora y vendedora.
- Validaciones en la base de datos para cantidades y montos.
- Exportación CSV protegida contra fórmulas de Excel insertadas mediante nombres de prendas.

## Archivos principales

- `index.html`, `styles.css`, `app.js`: interfaz y lógica de la calculadora.
- `supabase-schema.sql`: tablas, permisos, roles y automatizaciones de Supabase.
- `supabase-security-update.sql`: actualización de seguridad para instalaciones anteriores.
- `vercel.json`: cabeceras de seguridad del sitio estático.
- `config.js`: configuración local de la URL y clave pública del proyecto.
