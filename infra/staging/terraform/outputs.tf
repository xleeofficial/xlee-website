output "staging_network_name" {
  description = "Name of staging VPC when resources are explicitly enabled."
  value       = try(google_compute_network.staging[0].name, null)
}
output "staging_subnet_name" {
  description = "Name of staging subnet when resources are explicitly enabled."
  value       = try(google_compute_subnetwork.staging[0].name, null)
}
output "staging_nat_name" {
  description = "Name of staging NAT gateway when resources are explicitly enabled."
  value       = try(google_compute_router_nat.staging[0].name, null)
}
