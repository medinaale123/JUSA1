# Jusa Boutique · Calculadora compartida

Aplicación estática para que el equipo comparta prendas, gastos y cálculos en tiempo real. La autenticación y los datos se guardan en Supabase; este proyecto no almacena contraseñas ni inventario en `localStorage`.

## Publicarla por primera vez

1. Creá un proyecto en [Supabase](https://supabase.com/dashboard).
2. En **SQL Editor**, creá una consulta nueva, pegá el contenido completo de `supabase-schema.sql` y ejecutalo una vez.
3. En **Authentication > Providers**, comprobá que **Email** esté habilitado. Es recomendable activar la confirmación de correo.
4. En **Project Settings > API**, copiá la **Project URL** y la clave **anon / publishable**. Pegalas en `config.js`. Nunca uses una clave `service_role` o `sb_secret` en ese archivo.
5. Publicá esta carpeta en un repositorio privado de GitHub. Después, en [Vercel](https://vercel.com), elegí **New Project**, importá el repositorio y presioná **Deploy**. Es un sitio estático: no necesita comando de compilación.
6. En Supabase, agregá la URL final de Vercel en **Authentication > URL Configuration > Site URL** y, si corresponde, en las Redirect URLs. Esto permite que el enlace de confirmación vuelva a la app.

## Primer acceso y equipo

1. La encargada crea una cuenta e inicia sesión.
2. En la pantalla de preparación, crea **Jusa Boutique**. Esa cuenta queda como **Administradora**.
3. Desde **Equipo**, la administradora prepara una invitación por correo y le avisa a la persona que debe registrarse con ese mismo correo.
4. Al crear y confirmar su cuenta, la persona entra automáticamente al inventario compartido. Las vendedoras pueden cargar, modificar y eliminar prendas/gastos; las administradoras también pueden invitar.

Las invitaciones actuales no envían un correo automático: solo habilitan el acceso de ese correo. Es deliberado para no requerir una clave de servicio ni un proveedor de correos adicional.

## Seguridad incluida

- Contraseñas gestionadas por Supabase Auth, nunca guardadas en el HTML.
- Row Level Security: solo integrantes de la boutique pueden consultar o modificar sus gastos y prendas.
- Roles de administradora y vendedora.
- Validaciones en la base de datos para cantidades y montos.
- Exportación CSV protegida contra fórmulas de Excel insertadas mediante nombres de prendas.

## Archivos principales

- `index.html`, `styles.css`, `app.js`: interfaz y lógica de la calculadora.
- `supabase-schema.sql`: tablas, permisos, roles y automatizaciones de Supabase.
- `config.js`: configuración local de la URL y clave pública del proyecto.
