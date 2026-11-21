provider "google" {
  project = var.project_id != "" ? var.project_id : null
  region  = var.region != "" ? var.region : null
}

locals {
  enabled = var.enable_staging_resources
  tags    = ["xlee-lens-egress-proxy-staging"]
}

resource "google_compute_network" "staging" {
  count                   = local.enabled ? 1 : 0
  name                    = "${var.resource_prefix}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  lifecycle {
    prevent_destroy = true
    precondition {
      condition = !var.enable_staging_resources || (
        var.project_id != "" &&
        var.region != "" &&
        var.confirm_dedicated_staging_project
      )
      error_message = "Resource creation requires a region, project ID, and explicit confirmation that the project is dedicated to staging."
    }
  }
}

resource "google_compute_subnetwork" "staging" {
  count                    = local.enabled ? 1 : 0
  name                     = "${var.resource_prefix}-subnet"
  region                   = var.region
  network                  = google_compute_network.staging[0].id
  ip_cidr_range             = var.subnet_cidr
  private_ip_google_access = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_router" "staging" {
  count   = local.enabled ? 1 : 0
  name    = "${var.resource_prefix}-router"
  region  = var.region
  network = google_compute_network.staging[0].id

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_router_nat" "staging" {
  count                              = local.enabled ? 1 : 0
  name                               = "${var.resource_prefix}-nat"
  router                             = google_compute_router.staging[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.staging[0].id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# DNS is allowed only to the Google metadata/DNS resolver on port 53.
# Other link-local access remains denied by the higher-priority deny rule.
resource "google_compute_firewall" "allow_dns" {
  count              = local.enabled ? 1 : 0
  name               = "${var.resource_prefix}-allow-dns"
  network            = google_compute_network.staging[0].name
  direction          = "EGRESS"
  priority           = 800
  target_tags        = local.tags
  destination_ranges = ["169.254.169.254/32"]

  allow {
    protocol = "udp"
    ports    = ["53"]
  }

  allow {
    protocol = "tcp"
    ports    = ["53"]
  }
}

# Explicitly deny selected IPv4 private and special-use ranges before public web.
# This list requires independent review and must be expanded/tested before use.
resource "google_compute_firewall" "deny_private_ipv4" {
  count              = local.enabled ? 1 : 0
  name               = "${var.resource_prefix}-deny-private-v4"
  network            = google_compute_network.staging[0].name
  direction          = "EGRESS"
  priority           = 900
  target_tags        = local.tags
  destination_ranges = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.88.99.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4"
  ]

  deny {
    protocol = "all"
  }
}

# IPv6 is intentionally blocked in this first draft. Do not open it without
# a separate IPv6 egress design and tests.
resource "google_compute_firewall" "deny_ipv6" {
  count              = local.enabled ? 1 : 0
  name               = "${var.resource_prefix}-deny-ipv6"
  network            = google_compute_network.staging[0].name
  direction          = "EGRESS"
  priority           = 900
  target_tags        = local.tags
  destination_ranges = ["::/0"]

  deny {
    protocol = "all"
  }
}

resource "google_compute_firewall" "allow_public_web" {
  count              = local.enabled ? 1 : 0
  name               = "${var.resource_prefix}-allow-public-web"
  network            = google_compute_network.staging[0].name
  direction          = "EGRESS"
  priority           = 1000
  target_tags        = local.tags
  destination_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
}

# Explicitly deny other IPv4 protocols/ports so implied allow-egress cannot
# silently open non-web traffic. VPC firewall rules are stateful.
resource "google_compute_firewall" "deny_other_ipv4_egress" {
  count              = local.enabled ? 1 : 0
  name               = "${var.resource_prefix}-deny-other-v4"
  network            = google_compute_network.staging[0].name
  direction          = "EGRESS"
  priority           = 2000
  target_tags        = local.tags
  destination_ranges = ["0.0.0.0/0"]

  deny {
    protocol = "all"
  }
}

# Intentionally omitted: Cloud Run service/IAM, service account, secrets and image deployment.
# Caller-auth design must be reviewed; the container image has not been published.
