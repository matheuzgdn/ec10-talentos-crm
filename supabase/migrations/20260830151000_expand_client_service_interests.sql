alter table public.clients
  drop constraint if exists clients_service_interest_check;

alter table public.clients
  add constraint clients_service_interest_check
  check (
    service_interest in (
      'plano_internacional',
      'plano_carreira',
      'ambos',
      'nao_definido',
      'eurocamp',
      'eurocamp_latam',
      'mentoria_prime',
      'libertacademy_florianopolis',
      'academy_sudamerica'
    )
  );
