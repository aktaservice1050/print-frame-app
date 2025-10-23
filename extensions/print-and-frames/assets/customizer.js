class PrintCustomizer {
  constructor() {
    this.selectedOptions = {
      frameType: "print-only",
      frameStyle: "black-matte",
      orientation: "landscape",
      printing: "full-color-standard",
      quantity: 1,
      price: 49,
      uploadedFile: null,
      fileUrl: null,
    };

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.updatePreview();
  }

  setupEventListeners() {
    // Frame Type
    document.querySelectorAll(".option-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        document
          .querySelectorAll(".option-btn")
          .forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this.selectedOptions.frameType = e.target.dataset.type;
        this.selectedOptions.price = parseInt(e.target.dataset.price);
        this.updatePreview();
      });
    });

    // Frame Style
    document.querySelectorAll(".style-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        document
          .querySelectorAll(".style-btn")
          .forEach((b) => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        this.selectedOptions.frameStyle = e.currentTarget.dataset.style;
        this.updatePreview();
      });
    });

    // Orientation
    document.querySelectorAll(".orient-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        document
          .querySelectorAll(".orient-btn")
          .forEach((b) => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        this.selectedOptions.orientation = e.currentTarget.dataset.orient;
        this.updatePreview();
      });
    });

    // Printing
    document.querySelectorAll('input[name="printing"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.selectedOptions.printing = e.target.value;
      });
    });

    // Quantity
    document.getElementById("decreaseQty").addEventListener("click", () => {
      const qtyInput = document.getElementById("quantity");
      if (qtyInput.value > 1) {
        qtyInput.value = parseInt(qtyInput.value) - 1;
        this.selectedOptions.quantity = qtyInput.value;
      }
    });

    document.getElementById("increaseQty").addEventListener("click", () => {
      const qtyInput = document.getElementById("quantity");
      qtyInput.value = parseInt(qtyInput.value) + 1;
      this.selectedOptions.quantity = qtyInput.value;
    });

    // File Upload
    const fileInput = document.getElementById("fileInput");
    const uploadArea = document.getElementById("uploadArea");

    uploadArea.addEventListener("click", () => fileInput.click());

    uploadArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      uploadArea.classList.add("dragging");
    });

    uploadArea.addEventListener("dragleave", () => {
      uploadArea.classList.remove("dragging");
    });

    uploadArea.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadArea.classList.remove("dragging");
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.handleFileUpload(files[0]);
      }
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        this.handleFileUpload(e.target.files[0]);
      }
    });

    // Remove file
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove-file")) {
        this.removeFile();
      }
    });

    // Add to Cart
    document.getElementById("addToCartBtn").addEventListener("click", () => {
      this.addToCart();
    });
  }

  async handleFileUpload(file) {
    // Validate file
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/pdf",
    ];

    if (!allowedTypes.includes(file.type)) {
      alert("Please upload JPG, PNG, or PDF files only");
      return;
    }

    if (file.size > maxSize) {
      alert("File size must be less than 10MB");
      return;
    }

    // Show loading
    const uploadArea = document.getElementById("uploadArea");
    uploadArea.classList.add("uploading");

    try {
      // Upload to your server
      const formData = new FormData();
      formData.append("file", file);
      formData.append(
        "productId",
        document.querySelector("[data-product-id]").dataset.productId,
      );

      const response = await fetch("/apps/customizer/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        this.selectedOptions.uploadedFile = file.name;
        this.selectedOptions.fileUrl = data.fileUrl;

        // Show preview
        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = (e) => {
            document.getElementById("uploadedImage").src = e.target.result;
            document.getElementById("uploadedImage").style.display = "block";
            document.getElementById("placeholder").style.display = "none";
          };
          reader.readAsDataURL(file);
        }

        // Update UI
        document.querySelector(".upload-placeholder").style.display = "none";
        document.getElementById("fileInfo").style.display = "flex";
        document.querySelector(".file-name").textContent = file.name;
        document.getElementById("addToCartBtn").disabled = false;
      } else {
        alert("Upload failed: " + data.error);
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Upload failed. Please try again.");
    } finally {
      uploadArea.classList.remove("uploading");
    }
  }

  removeFile() {
    this.selectedOptions.uploadedFile = null;
    this.selectedOptions.fileUrl = null;
    document.getElementById("fileInput").value = "";
    document.getElementById("uploadedImage").style.display = "none";
    document.getElementById("placeholder").style.display = "flex";
    document.querySelector(".upload-placeholder").style.display = "block";
    document.getElementById("fileInfo").style.display = "none";
    document.getElementById("addToCartBtn").disabled = true;
  }

  updatePreview() {
    const preview = document.getElementById("framePreview");
    const frameType = this.selectedOptions.frameType;
    const frameStyle = this.selectedOptions.frameStyle;
    const orientation = this.selectedOptions.orientation;

    // Update frame styling based on selections
    preview.className = `frame-preview ${frameType} ${frameStyle} ${orientation}`;
  }

  async addToCart() {
    const productId =
      document.querySelector("[data-product-id]").dataset.productId;

    const formData = {
      items: [
        {
          id: productId,
          quantity: this.selectedOptions.quantity,
          properties: {
            _frame_type: this.selectedOptions.frameType,
            _frame_style: this.selectedOptions.frameStyle,
            _orientation: this.selectedOptions.orientation,
            _printing: this.selectedOptions.printing,
            _file_url: this.selectedOptions.fileUrl,
            _file_name: this.selectedOptions.uploadedFile,
            _custom_price: this.selectedOptions.price,
          },
        },
      ],
    };

    try {
      const response = await fetch("/cart/add.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.items) {
        // Success - redirect to cart or show notification
        window.location.href = "/cart";
      }
    } catch (error) {
      console.error("Add to cart error:", error);
      alert("Failed to add to cart. Please try again.");
    }
  }
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  new PrintCustomizer();
});
