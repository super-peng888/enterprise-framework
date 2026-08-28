package com.framework.system.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

@Data
@Entity
@Table(name = "sys_menu")
public class SysMenu {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long parentId;

    private String title;

    /** dir 目录 / menu 菜单 / button 按钮（权限点）。 */
    private String type;

    private String path;

    private String icon;

    private String perm;

    private Integer sort;
}
