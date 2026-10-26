variable "enable_staging_resources" {
  description = "Explicit opt-in required before this draft creates resources. Keep false during review."
  type        = bool
  default     = false
}
variable "project_id" {
  description = "Dedicated staging-only Google Cloud project ID. Never use production."
  type        = string
  default     = ""
  validation {
    condition     = var.project_id == "" || can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be valid or empty while resource creation is disabled."
  }
}
variable "region" {
  description = "Chosen Cloud Run region; confirm availability and price before enabling resources."
  type        = string
  default     = ""
}
variable "subnet_cidr" {
  description = "Dedicated, non-overlapping IPv4 range for staging."
  type        = string
  default     = "10.82.0.0/26"
}
variable "resource_prefix" {
  description = "Short prefix for staging-only resources."
  type        = string
  default     = "xlee-lens-stg"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.resource_prefix))
    error_message = "resource_prefix must be 3–20 lowercase letters, digits, or hyphens and start with a letter."
  }
}
variable "confirm_dedicated_staging_project" {
  description = "Must be true only after verifying project_id is dedicated to staging."
  type        = bool
  default     = false
}
